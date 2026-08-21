-- Ensure dataset service coverage columns exist
alter table public.datasets
  add column if not exists service_coverage jsonb null,
  add column if not exists data_requests jsonb null;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';