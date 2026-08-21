-- Patch for project vhgkjxdwptirmyqjhiks (the project the app connects to).
--
-- Fixes: "Could not find the 'service_coverage' column of 'datasets' in
-- the schema cache" — this project never received the migration
-- 20260819120000_dataset_service_coverage.sql because the Supabase CLI
-- was linked to a different project (tavfqvcokeixntpljyhy).
--
-- Run in the Supabase dashboard SQL editor for vhgkjxdwptirmyqjhiks,
-- or: npx supabase db push --db-url "postgresql://postgres:<PASSWORD>@db.vhgkjxdwptirmyqjhiks.supabase.co:5432/postgres"
-- (the push variant applies ALL pending migrations, which is preferred —
--  see docs/STATUS.md note about project link mismatch).

alter table public.datasets
  add column if not exists service_coverage jsonb null,
  add column if not exists data_requests jsonb null;

comment on column public.datasets.service_coverage is
  'Snapshot of assessServiceCoverage() at import/analysis time';
comment on column public.datasets.data_requests is
  'Missing-role checklist requested from the client at import time';

-- Make PostgREST pick up the new columns immediately.
notify pgrst, 'reload schema';
