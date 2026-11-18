-- Short-lived anonymous NISAR capabilities. Only token hashes are persisted.
alter table public.scientific_jobs drop constraint if exists scientific_jobs_collection_id_check;
alter table public.scientific_jobs add constraint scientific_jobs_collection_id_check
  check ((workflow_id = 'sentinel2-ndvi' and collection_id = 'sentinel-2-l2a')
    or (workflow_id = 'nisar-gcov-change' and collection_id ~ '^C[A-Za-z0-9_-]{8,}
alter table public.scientific_jobs
  alter column user_id drop not null,
  add column if not exists guest_token_hash text,
  add column if not exists guest_expires_at timestamptz,
  add column if not exists request_fingerprint_hash text;

alter table public.scientific_jobs
  add constraint scientific_jobs_owner_or_guest_check
  check (
    (user_id is not null and guest_token_hash is null and guest_expires_at is null)
    or
    (user_id is null and guest_token_hash ~ '^[a-f0-9]{64}$'
      and guest_expires_at is not null
      and request_fingerprint_hash ~ '^[a-f0-9]{64}$')
  );

create unique index if not exists scientific_jobs_guest_token_hash_idx
  on public.scientific_jobs (guest_token_hash) where guest_token_hash is not null;

create table public.scientific_guest_rate_limits (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  jobs_created integer not null default 0 check (jobs_created between 0 and 20),
  updated_at timestamptz not null default now()
);
alter table public.scientific_guest_rate_limits enable row level security;
revoke all on public.scientific_guest_rate_limits from public, anon, authenticated;
grant all on public.scientific_guest_rate_limits to service_role;

create function public.enqueue_guest_nisar_gcov_change_job(
  p_guest_token_hash text, p_fingerprint_hash text,
  p_before_product_id text, p_before_collection_concept_id text, p_before_granule_concept_id text,
  p_after_product_id text, p_after_collection_concept_id text, p_after_granule_concept_id text,
  p_aoi_geojson jsonb, p_frequency text, p_polarization_term text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_count integer;
begin
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[a-f0-9]{64}$'
    or p_fingerprint_hash is null or p_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest capability.';
  end if;
  if p_before_product_id is null or p_before_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$'
    or p_after_product_id is null or p_after_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$' then
    raise exception 'Valid NISAR GCOV product identifiers are required.';
  end if;
  if p_before_collection_concept_id is null or p_before_collection_concept_id !~ '^C[A-Za-z0-9_-]{8,}
    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9_-]{8,}
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;
));
alter table public.scientific_jobs
  alter column user_id drop not null,
  add column if not exists guest_token_hash text,
  add column if not exists guest_expires_at timestamptz,
  add column if not exists request_fingerprint_hash text;

alter table public.scientific_jobs
  add constraint scientific_jobs_owner_or_guest_check
  check (
    (user_id is not null and guest_token_hash is null and guest_expires_at is null)
    or
    (user_id is null and guest_token_hash ~ '^[a-f0-9]{64}$'
      and guest_expires_at is not null
      and request_fingerprint_hash ~ '^[a-f0-9]{64}$')
  );

create unique index if not exists scientific_jobs_guest_token_hash_idx
  on public.scientific_jobs (guest_token_hash) where guest_token_hash is not null;

create table public.scientific_guest_rate_limits (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  jobs_created integer not null default 0 check (jobs_created between 0 and 20),
  updated_at timestamptz not null default now()
);
alter table public.scientific_guest_rate_limits enable row level security;
revoke all on public.scientific_guest_rate_limits from public, anon, authenticated;
grant all on public.scientific_guest_rate_limits to service_role;

create function public.enqueue_guest_nisar_gcov_change_job(
  p_guest_token_hash text, p_fingerprint_hash text,
  p_before_product_id text, p_before_collection_concept_id text, p_before_granule_concept_id text,
  p_after_product_id text, p_after_collection_concept_id text, p_after_granule_concept_id text,
  p_aoi_geojson jsonb, p_frequency text, p_polarization_term text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_count integer;
begin
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[a-f0-9]{64}$'
    or p_fingerprint_hash is null or p_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest capability.';
  end if;
  if p_before_product_id is null or p_before_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$'
    or p_after_product_id is null or p_after_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$' then
    raise exception 'Valid NISAR GCOV product identifiers are required.';
  end if;
  if p_before_collection_concept_id is null or p_before_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;

    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;
));
alter table public.scientific_jobs
  alter column user_id drop not null,
  add column if not exists guest_token_hash text,
  add column if not exists guest_expires_at timestamptz,
  add column if not exists request_fingerprint_hash text;

alter table public.scientific_jobs
  add constraint scientific_jobs_owner_or_guest_check
  check (
    (user_id is not null and guest_token_hash is null and guest_expires_at is null)
    or
    (user_id is null and guest_token_hash ~ '^[a-f0-9]{64}$'
      and guest_expires_at is not null
      and request_fingerprint_hash ~ '^[a-f0-9]{64}$')
  );

create unique index if not exists scientific_jobs_guest_token_hash_idx
  on public.scientific_jobs (guest_token_hash) where guest_token_hash is not null;

create table public.scientific_guest_rate_limits (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  jobs_created integer not null default 0 check (jobs_created between 0 and 20),
  updated_at timestamptz not null default now()
);
alter table public.scientific_guest_rate_limits enable row level security;
revoke all on public.scientific_guest_rate_limits from public, anon, authenticated;
grant all on public.scientific_guest_rate_limits to service_role;

create function public.enqueue_guest_nisar_gcov_change_job(
  p_guest_token_hash text, p_fingerprint_hash text,
  p_before_product_id text, p_before_collection_concept_id text, p_before_granule_concept_id text,
  p_after_product_id text, p_after_collection_concept_id text, p_after_granule_concept_id text,
  p_aoi_geojson jsonb, p_frequency text, p_polarization_term text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_count integer;
begin
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[a-f0-9]{64}$'
    or p_fingerprint_hash is null or p_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest capability.';
  end if;
  if p_before_product_id is null or p_before_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$'
    or p_after_product_id is null or p_after_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$' then
    raise exception 'Valid NISAR GCOV product identifiers are required.';
  end if;
  if p_before_collection_concept_id is null or p_before_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;

    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;
));
alter table public.scientific_jobs
  alter column user_id drop not null,
  add column if not exists guest_token_hash text,
  add column if not exists guest_expires_at timestamptz,
  add column if not exists request_fingerprint_hash text;

alter table public.scientific_jobs
  add constraint scientific_jobs_owner_or_guest_check
  check (
    (user_id is not null and guest_token_hash is null and guest_expires_at is null)
    or
    (user_id is null and guest_token_hash ~ '^[a-f0-9]{64}$'
      and guest_expires_at is not null
      and request_fingerprint_hash ~ '^[a-f0-9]{64}$')
  );

create unique index if not exists scientific_jobs_guest_token_hash_idx
  on public.scientific_jobs (guest_token_hash) where guest_token_hash is not null;

create table public.scientific_guest_rate_limits (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  jobs_created integer not null default 0 check (jobs_created between 0 and 20),
  updated_at timestamptz not null default now()
);
alter table public.scientific_guest_rate_limits enable row level security;
revoke all on public.scientific_guest_rate_limits from public, anon, authenticated;
grant all on public.scientific_guest_rate_limits to service_role;

create function public.enqueue_guest_nisar_gcov_change_job(
  p_guest_token_hash text, p_fingerprint_hash text,
  p_before_product_id text, p_before_collection_concept_id text, p_before_granule_concept_id text,
  p_after_product_id text, p_after_collection_concept_id text, p_after_granule_concept_id text,
  p_aoi_geojson jsonb, p_frequency text, p_polarization_term text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_count integer;
begin
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[a-f0-9]{64}$'
    or p_fingerprint_hash is null or p_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest capability.';
  end if;
  if p_before_product_id is null or p_before_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$'
    or p_after_product_id is null or p_after_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$' then
    raise exception 'Valid NISAR GCOV product identifiers are required.';
  end if;
  if p_before_collection_concept_id is null or p_before_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;

    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;
));
alter table public.scientific_jobs
  alter column user_id drop not null,
  add column if not exists guest_token_hash text,
  add column if not exists guest_expires_at timestamptz,
  add column if not exists request_fingerprint_hash text;

alter table public.scientific_jobs
  add constraint scientific_jobs_owner_or_guest_check
  check (
    (user_id is not null and guest_token_hash is null and guest_expires_at is null)
    or
    (user_id is null and guest_token_hash ~ '^[a-f0-9]{64}$'
      and guest_expires_at is not null
      and request_fingerprint_hash ~ '^[a-f0-9]{64}$')
  );

create unique index if not exists scientific_jobs_guest_token_hash_idx
  on public.scientific_jobs (guest_token_hash) where guest_token_hash is not null;

create table public.scientific_guest_rate_limits (
  fingerprint_hash text primary key check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  jobs_created integer not null default 0 check (jobs_created between 0 and 20),
  updated_at timestamptz not null default now()
);
alter table public.scientific_guest_rate_limits enable row level security;
revoke all on public.scientific_guest_rate_limits from public, anon, authenticated;
grant all on public.scientific_guest_rate_limits to service_role;

create function public.enqueue_guest_nisar_gcov_change_job(
  p_guest_token_hash text, p_fingerprint_hash text,
  p_before_product_id text, p_before_collection_concept_id text, p_before_granule_concept_id text,
  p_after_product_id text, p_after_collection_concept_id text, p_after_granule_concept_id text,
  p_aoi_geojson jsonb, p_frequency text, p_polarization_term text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_count integer;
begin
  if p_guest_token_hash is null or p_guest_token_hash !~ '^[a-f0-9]{64}$'
    or p_fingerprint_hash is null or p_fingerprint_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid guest capability.';
  end if;
  if p_before_product_id is null or p_before_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$'
    or p_after_product_id is null or p_after_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$' then
    raise exception 'Valid NISAR GCOV product identifiers are required.';
  end if;
  if p_before_collection_concept_id is null or p_before_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR acquisition identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;
  if p_aoi_geojson is null or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_fingerprint_hash, 0));
  insert into public.scientific_guest_rate_limits(fingerprint_hash, window_started_at, jobs_created, updated_at)
  values (p_fingerprint_hash, v_now, 1, v_now)
  on conflict (fingerprint_hash) do update set
    window_started_at = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then v_now else public.scientific_guest_rate_limits.window_started_at end,
    jobs_created = case when public.scientific_guest_rate_limits.window_started_at < v_now - interval '1 hour'
      then 1 else public.scientific_guest_rate_limits.jobs_created + 1 end,
    updated_at = v_now
  returning jobs_created into v_count;
  if v_count > 3 then raise exception 'Guest rate-limit reached. Retry after one hour.'; end if;

  if exists (
    select 1 from public.scientific_jobs
    where request_fingerprint_hash = p_fingerprint_hash and user_id is null
      and status in ('queued', 'processing') and guest_expires_at > v_now
  ) then raise exception 'An active guest investigation already exists for this browser.'; end if;

  insert into public.scientific_jobs (
    user_id, guest_token_hash, guest_expires_at, request_fingerprint_hash,
    workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  ) values (
    null, p_guest_token_hash, v_now + interval '24 hours', p_fingerprint_hash,
    'nisar-gcov-change', p_before_collection_concept_id, p_before_product_id, p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  ) returning id into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.enqueue_guest_nisar_gcov_change_job(text,text,text,text,text,text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.claim_next_scientific_job()
returns setof public.scientific_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Guest investigation expired before completion.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where user_id is null and guest_expires_at <= pg_catalog.now()
    and status in ('queued','processing');

  update public.scientific_jobs set status='failed', stage='failed', progress=100,
    error_message='Worker lease expired after the maximum retry count.', lease_expires_at=null,
    completed_at=pg_catalog.now(), updated_at=pg_catalog.now()
  where status='processing' and lease_expires_at < pg_catalog.now() and attempts >= 3;

  return query
  with next_job as (
    select id from public.scientific_jobs
    where cancel_requested_at is null
      and (user_id is not null or guest_expires_at > pg_catalog.now())
      and ((status='queued' and available_at <= pg_catalog.now())
        or (status='processing' and lease_expires_at < pg_catalog.now() and attempts < 3))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.scientific_jobs job set status='processing', stage='discovering',
    progress=greatest(job.progress,5), attempts=job.attempts+1,
    lease_expires_at=pg_catalog.now()+interval '15 minutes',
    started_at=coalesce(job.started_at,pg_catalog.now()), updated_at=pg_catalog.now(), error_message=null
  from next_job where job.id=next_job.id returning job.*;
end;
$$;
revoke all on function public.claim_next_scientific_job() from public, anon, authenticated;
grant execute on function public.claim_next_scientific_job() to service_role;
