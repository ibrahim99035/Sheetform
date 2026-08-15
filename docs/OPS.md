# SiroQ — Operations Runbook

> Production-grade practices for SiroQ. Keep in sync with `docs/SPECS.md`.

## Environments

| Env | Vercel / host | Supabase project | Who |
| --- | --- | --- | --- |
| Local | `npm run dev` | local `supabase start` (or dev project) | developers |
| Staging | preview / `staging` branch | **separate** staging project | QA + stakeholders |
| Production | `main` branch → Vercel | production project | operators, end users |

**Rule:** staging and production must never share a Supabase project.

## Deploy pipeline

1. PR → CI (`/.github/workflows/ci.yml`): install → lint → typecheck → unit tests → production build. Merge is blocked on red CI.
2. Merge to `main` → Vercel production. Push to `staging` (or use a PR preview env) → staging.
3. Database migrations are applied **separately from code**:
   ```bash
   node scripts/push-migrations.mjs        # idempotent; tracks applied in public._applied_migrations
   ```
   Apply to staging → smoke → apply to production. Migration files must be additive once merged.
4. Edge Functions (`supabase/functions/*`) are deployed with Supabase:
   ```bash
   npx supabase functions deploy import-dataset
   npx supabase functions deploy deliver-reports
   ```

## Deliveries (report email / WhatsApp)

- Queue: operator publishes a report → `queue_report_deliveries(report_id, kind|null)`
  (superadmin RPC) inserts one `deliveries` row per enabled recipient address
  (`branch_profiles.email_delivery`/`whatsapp_delivery`). Rows are rendered +
  sent by the `deliver-reports` Edge Function (or the local mirror
  `scripts/deliver-reports.mjs` for staging/CI).
- Status machine: `queued → processing → delivered | failed | skipped`.
  Worker claims with an `eq(status,'queued')` guard; ≤ 3 attempts; failure
  records `last_error`; `retry_deliveries(report_id)` re-queues failed/skipped.
- Dry-run: `DRY_RUN=1` marks deliveries delivered without sending — the
  default in the mirror and used by e2e. Production must unset it.
- Email provider: Resend (set `RESEND_API_KEY`, `RESEND_FROM`). WhatsApp is
  the Meta Cloud API adapter (set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`);
  without them rows end `failed` with `NO_EMAIL_PROVIDER` /
  `NO_WHATSAPP_PROVIDER`, which is the intended "not configured" signal.
- Secrets: `npx supabase secrets set RESEND_API_KEY=... RESEND_FROM=... WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... --project-ref <ref>`

## Compliance (classification, retention, DSR, terms)

- **Classification:** every template carries a `sensitivity` (`none` / `sales_financial` /
  `patient_health`); datasets inherit it through `templates.code`. Policy lives in
  `public.retention_policies` (seeded: `none` → keep, `sales_financial` → 36 mo,
  `patient_health` → 72 mo). Edit the table to change windows — the reader
  `_sf_retention_months(dataset_id)` resolves live.
- **Retention enforcement:** `archive_dataset(id)` soft-freezes a dataset
  (`status → 'purged'`, rows kept); `purge_dataset(id)` hard-deletes rows, stats,
  operations, the storage object, and the dataset row (audit-backed). A dataset
  must be archived and past its window before purging (`NOT_PURGED` / `KEEP_FOREVER`).
- **Sweep:** `purge_expired(cutoff, purge, dataset_ids)` archives then optionally
  hard-purges every eligible dataset. Registered as a weekly pg_cron job
  (`siroq-retention-sweep`, Sunday 03:00) on hosted Supabase; the registration is
  guarded so migrations work where pg_cron is absent. Sweeps are idempotent and
  resumable (already-archived rows are included).
- **Direct SQL deletes from `storage.objects`** are blocked by the storage extension;
  `purge_dataset` uses `set local storage.allow_delete_query = 'true'` (the sanctioned
  escape hatch) before deleting — do not remove that guard.
- **DSR:** users call `request_subject_action('export'|'delete', note)`;
  operators resolve via `process_subject_request(id, 'done'|'rejected')`. Exports
  store role-scoped data in `subject_requests.payload`; deletes drop the user's
  footprint (memberships). Removal of the Auth user itself is a manual ops step —
  record it in `audit_log`.
- **Terms:** versioned in `public.terms`; `accept_terms()` records acceptance
  (`terms_acceptances`, idempotent). `current_terms()` / `terms_pending()` drive
  the consent banner. Gating submit flows on `terms_pending()` is a frontend step.
- **Run a retention dry run before the real thing:**
  `select public.purge_expired(now(), purge := false)` (superadmin RPC) reports the
  eligible count; then run with `purge := true`.

## Observability

- Server/client errors → Sentry (`instrumentation.ts` `onRequestError`). No DSN configured => releases go to server logs only.
- Structured JSON logs from `lib/log.ts` (request id + user context) → Vercel logs.
- Edge Function logs/exceptions → Supabase Edge Logs; correlate by `datasetId`.

## Import pipeline

- Status machine: `pending → processing → ready | error`. Claim is guarded (`eq(status,'pending')`) so retries are idempotent.
- A dataset left in `pending` or `error` after ≤ a few minutes is stuck — use the **Retry import** control (operator UI → `retry_import(dataset_id)` RPC) rather than re-uploading.
- File limits enforced at every gate (client estimate, server action, Edge Function): ≤ 1,000,000 data rows, ≤ 25 MB upload.

## Incidents

1. Observe: Sentry alert / Vercel logs / Supabase dashboard.
2. Triaging a stuck import: inspect `datasets.status` + `error_message`; if ingest crashed, run `retry_import`.
3. Hotfix path: migration forward-only; roll back a bad deploy by reverting in Vercel (never DROP data).
4. Audit: every sensitive action appears in `public.audit_log` (append-only).

## Backups & data safety

- Supabase managed Postgres: enable daily backups + PITR on production.
- `uploads` bucket objects are covered by the same retention policy as their dataset; purge jobs must respect `audit_log` retention requirements.
- **audit_log is append-only** and exempt from retention purges — mask/rotate live data, never delete the log.