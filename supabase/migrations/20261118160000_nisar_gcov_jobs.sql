alter table public.scientific_jobs
  drop constraint if exists scientific_jobs_workflow_id_check,
  drop constraint if exists scientific_jobs_collection_id_check;

alter table public.scientific_jobs
  add constraint scientific_jobs_workflow_id_check
    check (workflow_id in ('sentinel2-ndvi', 'nisar-gcov-change')),
  add constraint scientific_jobs_collection_id_check
    check (collection_id in ('sentinel-2-l2a', 'nisar-gcov'));

alter table public.scientific_jobs
  add column if not exists before_product_id text,
  add column if not exists after_product_id text,
  add column if not exists before_collection_concept_id text,
  add column if not exists after_collection_concept_id text,
  add column if not exists before_granule_concept_id text,
  add column if not exists after_granule_concept_id text,
  add column if not exists bounds_wgs84 jsonb,
  add column if not exists frequency text,
  add column if not exists polarization_term text;

alter table public.scientific_jobs
  add constraint scientific_jobs_nisar_metadata_check
  check (
    workflow_id <> 'nisar-gcov-change'
    or (
      collection_id = 'nisar-gcov'
      and before_product_id is not null
      and after_product_id is not null
      and before_collection_concept_id ~ '^C[A-Za-z0-9_-]+$'
      and after_collection_concept_id ~ '^C[A-Za-z0-9_-]+$'
      and before_granule_concept_id ~ '^G[A-Za-z0-9_-]+$'
      and after_granule_concept_id ~ '^G[A-Za-z0-9_-]+$'
      and frequency in ('frequencyA', 'frequencyB')
      and polarization_term in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV')
      and pg_catalog.jsonb_typeof(bounds_wgs84) = 'array'
      and pg_catalog.jsonb_array_length(bounds_wgs84) = 4
    )
  );

create index if not exists scientific_jobs_nisar_queue_idx
  on public.scientific_jobs (available_at, created_at)
  where status = 'queued' and workflow_id = 'nisar-gcov-change';

comment on column public.scientific_jobs.bounds_wgs84 is
  'WGS84 [west,south,east,north] processing bounds for NISAR Harmony subsetting.';

comment on constraint scientific_jobs_nisar_metadata_check on public.scientific_jobs is
  'NISAR jobs require complete catalog identifiers, supported GCOV polarization metadata and bounded WGS84 processing extents.';
