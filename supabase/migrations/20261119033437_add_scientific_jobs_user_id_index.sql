create index if not exists scientific_jobs_user_id_idx
  on public.scientific_jobs (user_id)
  where user_id is not null;
