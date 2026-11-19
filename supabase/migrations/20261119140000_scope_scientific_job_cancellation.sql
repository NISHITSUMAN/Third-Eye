-- Keep cancellation scoped to the caller's own job.
-- The previous function also swept every expired processing lease before
-- checking ownership, allowing any authenticated caller to trigger a
-- database-wide maintenance update as a side effect of cancelling one job.
create or replace function public.cancel_scientific_job(p_job_id uuid)
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
