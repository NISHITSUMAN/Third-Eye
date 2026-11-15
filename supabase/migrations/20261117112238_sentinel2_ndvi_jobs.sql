create table public.scientific_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workflow_id text not null check (workflow_id = 'sentinel2-ndvi'),
  collection_id text not null check (collection_id = 'sentinel-2-l2a'),
  item_id text not null check (item_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  aoi_geojson jsonb not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  stage text not null default 'queued'
    check (stage in ('queued', 'discovering', 'retrieving', 'validating', 'processing', 'publishing', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0 check (attempts between 0 and 3),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  result jsonb,
  provenance jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint scientific_jobs_aoi_size check (pg_column_size(aoi_geojson) <= 100000)
);

create index scientific_jobs_queue_idx
  on public.scientific_jobs (available_at, created_at)
  where status = 'queued';

create index scientific_jobs_expired_lease_idx
  on public.scientific_jobs (lease_expires_at)
  where status = 'processing';

alter table public.scientific_jobs enable row level security;

create policy "Users can read their scientific jobs"
  on public.scientific_jobs
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.scientific_jobs from anon, authenticated;
grant select on public.scientific_jobs to authenticated;

create function public.enqueue_sentinel2_ndvi_job(
  p_item_id text,
  p_aoi_geojson jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before starting a scientific processing job.';
  end if;
  if p_item_id is null or p_item_id !~ '^[A-Za-z0-9._:-]{1,200}$' then
    raise exception 'A valid loaded Sentinel-2 item ID is required.';
  end if;
  if p_aoi_geojson is null
    or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or coalesce(p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon'), true) then
    raise exception 'Choose a polygon area of interest before processing.';
  end if;
  if coalesce(pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array', true) then
    raise exception 'The area of interest has invalid coordinates.';
  end if;
  if pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'The area of interest is too large to submit.';
  end if;

  insert into public.scientific_jobs (
    user_id,
    workflow_id,
    collection_id,
    item_id,
    aoi_geojson
  )
  values (
    auth.uid(),
    'sentinel2-ndvi',
    'sentinel-2-l2a',
    p_item_id,
    p_aoi_geojson
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_sentinel2_ndvi_job(text, jsonb) from public, anon;
grant execute on function public.enqueue_sentinel2_ndvi_job(text, jsonb) to authenticated;

create function public.cancel_scientific_job(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.scientific_jobs
  set
    status = 'cancelled',
    stage = 'cancelled',
    progress = 100,
    lease_expires_at = null,
    completed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where status = 'processing'
    and cancel_requested_at is not null
    and lease_expires_at < pg_catalog.now();

  update public.scientific_jobs
  set
    status = case when status = 'queued' then 'cancelled' else status end,
    stage = case when status = 'queued' then 'cancelled' else stage end,
    progress = case when status = 'queued' then 100 else progress end,
    cancel_requested_at = pg_catalog.now(),
    completed_at = case when status = 'queued' then pg_catalog.now() else completed_at end,
    updated_at = pg_catalog.now()
  where id = p_job_id
    and user_id = auth.uid()
    and status in ('queued', 'processing')
  returning status into v_status;

  if v_status is null then
    raise exception 'The job was not found or can no longer be cancelled.';
  end if;

  return v_status;
end;
$$;

revoke all on function public.cancel_scientific_job(uuid) from public, anon;
grant execute on function public.cancel_scientific_job(uuid) to authenticated;

create function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.scientific_jobs
  set
    status = 'failed',
    stage = 'failed',
    progress = 100,
    error_message = 'Worker lease expired after the maximum retry count.',
    lease_expires_at = null,
    completed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where status = 'processing'
    and lease_expires_at < pg_catalog.now()
    and attempts >= 3;

  return query
  with next_job as (
    select id
    from public.scientific_jobs
    where cancel_requested_at is null
      and (
        (status = 'queued' and available_at <= pg_catalog.now())
        or (status = 'processing' and lease_expires_at < pg_catalog.now() and attempts < 3)
      )
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.scientific_jobs as job
  set
    status = 'processing',
    stage = 'discovering',
    progress = greatest(job.progress, 5),
    attempts = job.attempts + 1,
    lease_expires_at = pg_catalog.now() + interval '15 minutes',
    started_at = coalesce(job.started_at, pg_catalog.now()),
    updated_at = pg_catalog.now(),
    error_message = null
  from next_job
  where job.id = next_job.id
  returning job.*;
end;
$$;

revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scientific-results',
  'scientific-results',
  false,
  52428800,
  array['image/tiff', 'image/png']
)
on conflict (id) do nothing;

create policy "Users can read their completed scientific outputs"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'scientific-results'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.scientific_jobs as job
      where job.id::text = (storage.foldername(name))[2]
        and job.user_id = (select auth.uid())
        and job.status = 'completed'
    )
  );
