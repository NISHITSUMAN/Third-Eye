-- NISAR GCOV change jobs use the existing authenticated scientific queue.
-- Guest capabilities are intentionally kept out of this migration until the
-- public API can issue and verify server-generated, hashed capabilities.
alter table public.scientific_jobs
  drop constraint if exists scientific_jobs_workflow_id_check,
  drop constraint if exists scientific_jobs_collection_id_check;

alter table public.scientific_jobs
  add constraint scientific_jobs_workflow_id_check
    check (workflow_id in ('sentinel2-ndvi', 'nisar-gcov-change')),
  add constraint scientific_jobs_collection_id_check
    check (
      (workflow_id = 'sentinel2-ndvi' and collection_id = 'sentinel-2-l2a')
      or (workflow_id = 'nisar-gcov-change' and collection_id ~ '^C[A-Za-z0-9]{8,}$')
    ),
  add column if not exists nisar_parameters jsonb;

alter table public.scientific_jobs
  add constraint scientific_jobs_nisar_parameters_check
  check (
    (workflow_id = 'sentinel2-ndvi' and nisar_parameters is null)
    or
    (workflow_id = 'nisar-gcov-change'
      and pg_catalog.jsonb_typeof(nisar_parameters) = 'object'
      and pg_catalog.pg_column_size(nisar_parameters) <= 10000)
  );

create function public.enqueue_nisar_gcov_change_job(
  p_before_product_id text,
  p_before_collection_concept_id text,
  p_before_granule_concept_id text,
  p_after_product_id text,
  p_after_collection_concept_id text,
  p_after_granule_concept_id text,
  p_aoi_geojson jsonb,
  p_frequency text,
  p_polarization_term text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_active_jobs integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required for scientific processing.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );

  select count(*) into v_active_jobs
  from public.scientific_jobs
  where user_id = auth.uid()
    and status in ('queued', 'processing');

  if v_active_jobs >= 2 then
    raise exception 'You already have two active scientific jobs. Wait for one to finish.';
  end if;

  if p_before_product_id is null
    or p_before_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$'
    or p_after_product_id is null
    or p_after_product_id !~ '^NISAR_[LS][0-3]_[A-Z]{2}_GCOV_[A-Za-z0-9_]+$' then
    raise exception 'Valid NISAR GCOV product identifiers are required.';
  end if;

  if p_before_collection_concept_id is null or p_before_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_after_collection_concept_id is null or p_after_collection_concept_id !~ '^C[A-Za-z0-9]{8,}$'
    or p_before_granule_concept_id is null or p_before_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$'
    or p_after_granule_concept_id is null or p_after_granule_concept_id !~ '^G[A-Za-z0-9]{8,}$' then
    raise exception 'Valid NASA CMR collection and granule concept IDs are required.';
  end if;

  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR frequency or covariance term.';
  end if;

  if p_aoi_geojson is null
    or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' is null
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.jsonb_typeof(p_aoi_geojson -> 'coordinates') <> 'array'
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid Polygon or MultiPolygon AOI is required.';
  end if;

  insert into public.scientific_jobs (
    user_id, workflow_id, collection_id, item_id, aoi_geojson, nisar_parameters
  )
  values (
    auth.uid(),
    'nisar-gcov-change',
    p_before_collection_concept_id,
    p_before_product_id,
    p_aoi_geojson,
    pg_catalog.jsonb_build_object(
      'before_granule_concept_id', p_before_granule_concept_id,
      'after_product_id', p_after_product_id,
      'after_collection_concept_id', p_after_collection_concept_id,
      'after_granule_concept_id', p_after_granule_concept_id,
      'frequency', p_frequency,
      'polarization_term', p_polarization_term
    )
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_nisar_gcov_change_job(text, text, text, text, text, text, jsonb, text, text) from public, anon;
grant execute on function public.enqueue_nisar_gcov_change_job(text, text, text, text, text, text, jsonb, text, text) to authenticated;
