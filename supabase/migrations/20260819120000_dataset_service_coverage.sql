-- ============================================================
-- P2.3 — Service coverage + data requests on datasets
--
-- Adds two nullable JSONB columns to `datasets`:
--   * `service_coverage` — snapshot of `assessServiceCoverage()` at
--     import time so the operator can review which services the file
--     powers without re-running inference.
--   * `data_requests` — the "ask the client for missing data"
--     checklist produced by the coverage card in the upload flow.
--
-- Both columns are NULL by default so existing rows are unaffected.
-- RLS policies already cover `datasets`; no new policies needed.
-- ============================================================

alter table public.datasets
  add column if not exists service_coverage jsonb null,
  add column if not exists data_requests    jsonb null;

comment on column public.datasets.service_coverage is
  'Snapshot of assessServiceCoverage() at import time (array of ServiceCoverage objects).';
comment on column public.datasets.data_requests is
  'Requested missing-role checklist from the upload flow (array of {role, label}).';
