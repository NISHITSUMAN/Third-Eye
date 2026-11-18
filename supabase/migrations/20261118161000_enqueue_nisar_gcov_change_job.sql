
create or replace function public.enqueue_nisar_gcov_change_job(
  p_before_product_id text,
  p_after_product_id text,
  p_before_collection_concept_id text,
  p_after_collection_concept_id text,
  p_before_granule_concept_id text,
  p_after_granule_concept_id text,
  p_aoi_geojson jsonb,
  p_bounds_wgs84 jsonb,
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
  v_west double precision;
  v_south double precision;
  v_east double precision;
  v_north double precision;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to submit a scientific processing job.';
  end if;
  if p_before_product_id is null or length(p_before_product_id) > 240
    or p_after_product_id is null or length(p_after_product_id) > 240 then
    raise exception 'Valid before and after NISAR product identifiers are required.';
  end if;
  if p_before_collection_concept_id !~ '^C[A-Za-z0-9_-]+$'
    or p_after_collection_concept_id !~ '^C[A-Za-z0-9_-]+$'
    or p_before_granule_concept_id !~ '^G[A-Za-z0-9_-]+$'
    or p_after_granule_concept_id !~ '^G[A-Za-z0-9_-]+$' then
    raise exception 'Valid NASA CMR collection and granule concept identifiers are required.';
  end if;
  if p_frequency not in ('frequencyA', 'frequencyB')
    or p_polarization_term not in ('HHHH', 'HVHV', 'VVVV', 'VHVH', 'RHRH', 'RVRV') then
    raise exception 'Unsupported NISAR GCOV frequency or polarization term.';
  end if;
  if p_aoi_geojson is null
    or pg_catalog.jsonb_typeof(p_aoi_geojson) <> 'object'
    or p_aoi_geojson ->> 'type' not in ('Polygon', 'MultiPolygon')
    or pg_catalog.pg_column_size(p_aoi_geojson) > 100000 then
    raise exception 'A valid bounded polygon area of interest is required.';
  end if;
  if p_bounds_wgs84 is null
    or pg_catalog.jsonb_typeof(p_bounds_wgs84) <> 'array'
    or pg_catalog.jsonb_array_length(p_bounds_wgs84) <> 4 then
    raise exception 'Supply WGS84 bounds as [west,south,east,north].';
  end if;

  begin
    v_west := (p_bounds_wgs84 ->> 0)::double precision;
    v_south := (p_bounds_wgs84 ->> 1)::double precision;
    v_east := (p_bounds_wgs84 ->> 2)::double precision;
    v_north := (p_bounds_wgs84 ->> 3)::double precision;
  exception when others then
    raise exception 'The NISAR WGS84 bounds must contain four numbers.';
  end;
  if not (v_west >= -180 and v_west < v_east and v_east <= 180
    and v_south >= -90 and v_south < v_north and v_north <= 90
    and v_east - v_west <= 2 and v_north - v_south <= 2) then
    raise exception 'NISAR bounds must be valid WGS84 and no wider than two degrees per axis.';
  end if;

  insert into public.scientific_jobs (
    user_id, workflow_id, collection_id, item_id, aoi_geojson,
    before_product_id, after_product_id,
    before_collection_concept_id, after_collection_concept_id,
    before_granule_concept_id, after_granule_concept_id,
    bounds_wgs84, frequency, polarization_term
  ) values (
    auth.uid(), 'nisar-gcov-change', 'nisar-gcov', p_after_granule_concept_id, p_aoi_geojson,
    p_before_product_id, p_after_product_id,
    p_before_collection_concept_id, p_after_collection_concept_id,
    p_before_granule_concept_id, p_after_granule_concept_id,
    p_bounds_wgs84, p_frequency, p_polarization_term
  ) returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_nisar_gcov_change_job(
  text, text, text, text, text, text, jsonb, jsonb, text, text
) from public, anon;
grant execute on function public.enqueue_nisar_gcov_change_job(
  text, text, text, text, text, text, jsonb, jsonb, text, text
) to authenticated;
