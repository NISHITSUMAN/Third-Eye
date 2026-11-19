-- Allow the private scientific-results bucket to store generated GeoJSON vectors.
update storage.buckets
set allowed_mime_types = array(
  select distinct mime_type
  from unnest(
    coalesce(allowed_mime_types, array[]::text[])
    || array['application/geo+json']::text[]
  ) as mime_type
)
where id = 'scientific-results';
