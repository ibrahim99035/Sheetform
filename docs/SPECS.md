# SiroQ — Product Specs

> CSV / Excel analytics platform. Upload a spreadsheet, preview and edit it in a
> virtualized table, run transforms with full undo/redo, explore aggregated
> views, and export the result. Multi-user with a superadmin role.

---

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS v4, lucide-react icons |
| Data fetching | TanStack Query + virtual rows via @tanstack/react-virtual |
| Charts | Recharts |
| Files | `xlsx`, `papaparse` (client-side parse on upload) |
| Backend | Supabase: Postgres + Auth (email/password) + Storage + Realtime + DB webhook → Edge Function |
| Language | TypeScript (strict) |
| Deployment | Vercel (`https://siroq.vercel.app/`) |

## Product features

- **Upload & import** — drag-and-drop CSV / XLSX / XLS. Headers + types are
  detected on the client, the file is uploaded to a private storage bucket, a
  `pending` row is inserted, and a DB webhook hands it to the
  `import-dataset` Edge Function which parses it into `dataset_rows`,
  computes per-column stats, and flips the dataset to `ready` (or `error`).
- **Virtualized data table** — windowed fetch (`get_dataset_rows`, 200/page),
  sortable + filterable columns, sticky header and sticky `#` column,
  infinite scroll, cell editing via double-click (desktop) or tap (touch),
  live row/result counts.
- **Transforms with undo/redo** — `rename_column`, `filter_rows`, `dedupe`,
  `edit_cell`. Every operation records payload + inverse in
  `dataset_operations`; `undo_operation` / `redo_operation` replay them.
  Column stats are recomputed after each mutation.
- **Analyze** — column stats table (type, distinct, empty, min/max/avg/sum)
  and a group-by aggregation builder (count / sum / avg, top-N, min group
  size) rendered as a bar chart + result table.
- **Exports** — CSV (streamed) or XLSX of the *current view* (filters +
  sort applied), or the original uploaded file via signed URL.
- **Activity** — operation history (edit/rename/filter/dedupe with undo).
- **Theme** — light / dark with a no-flash inline init script, theme-aware
  tokens, autofill/caret overrides, and toasts.
- **Mobile responsiveness** — 44px touch targets, responsive shell, filter
  bar, analyze controls, tap-to-edit, sticky `#` column, safe-area toasts,
  `viewport-fit=cover`. Verified across a 320→1280px touch/desktop matrix.
- **Superadmin** — a user elevated to `admin_users` sees every user and their
  files (`/admin`), opens/edits/exports any dataset (full control), with the
  acting `user_id` recorded on each operation for audit.

## Data model (SCHEMA)

All tables live in `public` (created in `supabase/migrations/20260810180000_init.sql` unless noted).

| Table | Purpose |
| --- | --- |
| `datasets` | `id uuid, owner_id → auth.users, name, original_filename, storage_path, status (pending/processing/ready/error), error_message, row_count, column_defs jsonb [{key,label,type}], sheet_name, created_at, updated_at` |
| `dataset_rows` | `id, dataset_id FK, row_index, data jsonb, deleted_at (soft-delete), unique(dataset_id, row_index)` + `data` GIN index + partial index on live rows |
| `dataset_column_stats` | `(dataset_id, column_key)` PK, `min/max/avg/sum/distinct_count/null_count, computed_at` |
| `dataset_operations` | `id, dataset_id FK, user_id (acting user → audit), operation_type, payload jsonb, inverse_payload jsonb, applied_at, undone_at` |
| `admin_users` | `user_id PK → auth.users, created_at` — superadmin role table (migration `20260811120000_admin.sql`) |
| `_applied_migrations` | bookkeeping for `scripts/push-migrations.mjs` (which migrations already ran remotely) |

Storage: private bucket `uploads`, object path `{owner_id}/...`.

## Security model

- **RLS everywhere.** Owners access their datasets via `owner_id = auth.uid()`;
  rows/stats/operations access via "owner via dataset" subqueries; storage via
  folder = `auth.uid()`.
- **Superadmin** — `admin_users` has own-row select/update RLS policies only
  (no insert/delete for authenticated users → elevation requires the service
  role). `is_superadmin()` is SECURITY DEFINER with `set search_path = public`.
  Every owner / storage policy is extended with `or public.is_superadmin()`,
  giving admins full control of any dataset while all app functions stay
  SECURITY INVOKER and keep relying on RLS.
- Admin RPCs (`admin_list_users`, `admin_list_datasets`) are SECURITY DEFINER
  and self-guard with `if not is_superadmin() then raise exception 'FORBIDDEN'`.
- **Audit** — `dataset_operations.user_id` records whoever applied an
  operation, so admin edits are attributable.
- The only explicit app-level ownership check is the export route
  (`app/api/datasets/[id]/export/route.ts`), which now also permits admins.
- Policy details (trust model, retention, DSR, incident response) live in
  [`SECURITY.md`](../SECURITY.md) — kept in sync with compliance changes.

## Key DB functions (RPCs, SECURITY INVOKER unless noted)

| Function | Purpose |
| --- | --- |
| `_sf_column_type(defs,key)` | resolve declared type from column_defs |
| `_sf_filter_condition(view,defs)` | build safe SQL WHERE from view filters (literals only — no identifier injection) |
| `_sf_sort_clause(view,defs)` | build ORDER BY for a view |
| `_sf_recompute_column_stats(dataset,column,type)` | aggregate live rows into stats |
| `_sf_rename_column(dataset,old,new,label)` | rewrite `data` keys + column_defs |
| `_sf_soft_delete_rows(dataset, id[])` | soft-delete rows (filter/dedupe) |
| `get_dataset_rows(dataset, view, page_size, offset)` | windowed sorted/filtered rows |
| `get_dataset_row_count(dataset, view)` | matching row count |
| `group_by(dataset, group_col, agg_col, agg_fn, top_n, min_count)` | aggregation for Analyze |
| `apply_operation(dataset, op, params)` | rename / filter / dedupe / edit-cell + op log + stats recompute |
| `undo_operation(dataset)` / `redo_operation(dataset)` | replay inverses/operations |
| `is_superadmin()` | **SECURITY DEFINER** role check |
| `admin_list_users()` / `admin_list_datasets(uid)` | **SECURITY DEFINER** admin queries |
| `append_audit(action, entity_type, entity_id, metadata, org_id)` | **SECURITY DEFINER** append-only audit write (actor = `auth.uid()`) |
| `retry_import(dataset_id)` | **SECURITY DEFINER** superadmin-only; resets stuck/failed dataset to `pending` |

## Migrations

| File | Contents |
| --- | --- |
| `20260810180000_init.sql` | tables, storage bucket + policies, helper/read/analyze/transform functions, grants, RLS, realtime publication |
| `20260811120000_admin.sql` | `admin_users`, `is_superadmin()`, `or is_superadmin()` on all owner/storage policies, `admin_list_users` / `admin_list_datasets` |
| `20260814120000_org_model.sql` | organization model: branches (pharmacies), members, applications, reports + access-gated items; dataset RLS cutover to superadmin-only |
| `20260814130000_org_fix.sql` | branch-delete protection via RLS (allows org cascade deletes) |
| `20260814140000_op_timeout.sql` / `20260814150400_op_timeout_role.sql` | mutation RPC timeout handling (final: role-level `statement_timeout` for authenticated) |
| `20260815100000_hardening.sql` | append-only `audit_log` + triggers, `append_audit`, `retry_import` |
| `20260815200000_org_workflow.sql` | `templates`/`template_columns` (4 seeded: sales, product, financial, health) + role mapping, `branches.status` lifecycle, `branch_profiles` + licensing, extended `submit_application` (template + branch gate), `notifications` + `notify_user` + triggers |
| `20260815210000_branch_updated_at.sql` | add `branches.updated_at` (referenced by branch lifecycle RPCs) |
| `20260815300000_analysis.sql` | KPI engine: `_sf_to_num`/`_sf_to_ts` guarded casts, `_sf_template_key_map`, `dataset_kpis`, `time_series`, `compare_periods`, `association_rollup`, `snapshot_report_kpis` |
| `20260815310000_analysis_fix.sql` / `...333000_compare_v2.sql` | `compare_periods` v2: latest-vs-previous bucket via `time_series` (aliased inner columns) |
| `20260815320000_kpis_v2.sql` | `dataset_kpis` fix: `v_exp` (key text) vs `v_expense` (numeric accumulator) type clash; `- refund` in sales revenue |
| `20260815340000_rollup_snapshot_fix.sql` | resolve datasets→org through `application_files`/`applications` (no `datasets.organization_id`); drop `max(uuid)` misuse in `snapshot_report_kpis` |
| `20260815350000_snapshot_filter_fix.sql` | `snapshot_report_kpis` filters on `datasets.status='ready'` (not `deleted_at`) |
| `20260815400000_deliveries.sql` | delivery queue: `deliveries` table + RLS, `queue_report_deliveries(report, kind)`, `retry_deliveries(report)` (status machine `queued → processing → delivered|failed|skipped`) |
| `20260815410000_queue_ok_boolean.sql` | `queue_report_deliveries` fix: `v_org_status` must be `bool` (was `text`), so `if not v_org_status` compiles |
| `20260815500000_compliance.sql` | compliance: `retention_policies` (seeded 0/36/72 mo) + `_sf_retention_months`/`_sf_purge_eligible`, `archive_dataset`/`purge_dataset`/`purge_expired` (soft→hard, audit-backed, storage delete via `storage.allow_delete_query`), `subject_requests` + `request_subject_action`/`process_subject_request` (export/delete DSR), `terms`/`terms_acceptances` + `current_terms`/`terms_pending`/`accept_terms`; datasets gain `purged` status; guarded pg_cron `siroq-retention-sweep` |

> Note: `auth.users.email` is typed `varchar`, so the users RPC casts it
> (`email::text`) to satisfy PL/pgSQL `return query` type matching.

## Application surface

- `app/page.tsx` — landing
- `app/(auth)/login` / `app/(auth)/signup` — email/password auth (server actions in `lib/actions/auth.ts`)
- `app/(app)/datasets` — dataset list (create, open, delete)
- `app/(app)/datasets/new` — upload flow (`upload-flow.tsx`, `file-dropzone.tsx`)
- `app/(app)/datasets/[id]` — workspace (`dataset-workspace.tsx` → Data / Analyze / Activity tabs)
- `app/(app)/admin` — superadmin user table + per-user files modal (`components/admin-users.tsx`)
- `app/api/datasets/[id]/export` — CSV / XLSX / original export
- `proxy.ts` — Next middleware: session cookie refresh + route protection
- `components/*` — design-system primitives (`ui/*`), data table, tabs, dialogs, toasts, theme toggle

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/push-migrations.mjs` | Apply *pending* `supabase/migrations/*.sql` via Management API; tracks applied names in `public._applied_migrations` (idempotent; `init.sql` pre-seeded) |
| `scripts/add-admin.mjs <email> [--remove]` | Elevate/demote a user to superadmin (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`) |
| `scripts/create-webhook.mjs` | Register the DB webhook → `import-dataset` Edge Function |
| `scripts/e2e-smoke.mjs` | Import-pipeline smoke test (upload → pending → ready, print rows/stats) |
| `scripts/e2e-cleanup.mjs` | Clean up E2E datasets/users |
| `scripts/e2e-org.mjs` | Org-model e2e (create_owner → approve → pharmacist → submit → publish → RLS gating) |
| `scripts/e2e-analysis.mjs` | Phase-3 KPI e2e (branch licensing → sales-template submit → `dataset_kpis`/`time_series`/`compare_periods`/`association_rollup`/`snapshot_report_kpis` against `test/fixtures/sales.csv`) |
| `scripts/e2e-deliveries.mjs` | Phase-4 delivery-queue e2e (queue → worker dry-run → delivered, no-provider fail path, retry, RLS). Invokes `scripts/deliver-reports.mjs` in-process |
| `scripts/deliver-reports.mjs` | Local/CI mirror of the `deliver-reports` Edge Function: claims queued deliveries, renders KPI body, sends via Resend / Meta WhatsApp (or dry-runs when `DRY_RUN=1`, the default) |
| `scripts/e2e-compliance.mjs` | Phase-5 compliance e2e (retention_policies seed/RLS, `_sf_retention_months`/purge eligibility, archive→purge soft/hard, `purge_expired` dry+real sweep, DSR export/delete/reject + RLS, terms accept idempotence) |
| `scripts/e2e-reports.mjs` | Reports-workflow e2e (operator publish → RLS read side → snapshot KPIs → queue/retry deliveries → revise; non-superadmin FORBIDDEN asserted on every operator RPC) |
| `e2e/` (`npm run test:e2e`) | Committed Playwright suite (`@playwright/test`, reuses a running `npm run dev` or `E2E_BASE_URL`): COI/COEP isolation check (`crossOriginIsolated`, DuckDB COI bundle + worker assets served, CSP wasm/worker directives when present), public shell smoke, viewport-overflow matrix. Auth-gated specs run only when `E2E_EMAIL`/`E2E_PASSWORD` are set |

## Environment

`.env.example` documents: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`. Local `.env.local` (gitignored) mirrors this;
Vercel has its own env set.

## Production hardening (v0.2)

- **Audit (append-only)** — `audit_log(id, actor_id, organization_id, action, entity_type, entity_id, metadata, created_at)`. No update/delete grants for authenticated users; writes go through SECURITY DEFINER `append_audit` (actor is always `auth.uid()`). Triggers record dataset/application status changes, report publishes/revocations/revisions, org-profile reviews; the export route audits success. Readable by superadmins and members of the related org.
- **Observability** — `instrumentation.ts` (native Next 16 hook) initializes Sentry when `SENTRY_DSN` is set and forwards every server request error via `onRequestError`. `lib/log.ts` emits structured JSON lines with a per-request `requestId` (set in `proxy.ts`, surfaced as `x-request-id`).
- **Import recovery** — datasets stuck in `pending`/`error` are re-driven by the operator via **Retry import** in the workspace: `retry_import` (superadmin-only RPC) flips the dataset to `pending`, then the server action re-invokes the Edge Function with `WEBHOOK_SECRET`.
- **Limits (enforced at every gate)** — ≤ 1,000,000 data rows and ≤ 25 MB per upload (client dropzone, server action, Edge Function).
- **CI** — `.github/workflows/ci.yml` runs lint, typecheck, unit tests, and a production build on every PR; merge is blocked on red CI. Staging uses a separate Supabase project (`.env.staging.example`, `docs/OPS.md`).

## Mobile testing matrix

Playwright (playwright-core, `--no-sandbox` Chromium) against localhost and
Vercel: 320×568, 360×640, 390×844, 844×390 (landscape), 768×1024, 1024×768,
1280×800 — light + dark, touch on all but the last. Checks: no body
horizontal overflow, sticky `#` column after horizontal scroll, header/nav
visible, tap-to-edit opens a focused input, analyze chart renders without
overflow.

## Product vision (draft — subject to change)

The direction is NOT set in stone; this captures where the app is heading as
of Aug 2026. Tonight's stakeholder meeting may provide the full picture and
reshape it.

- **From generic tool → managed service for pharmacies.** The superadmin
  (operator) is the primary user of a real business service: client
  pharmacies supply their data (the "datasets"), and the operator runs
  operations + analysis on that data to produce **advice / insights** for each
  pharmacy.
- **Advice delivery** — the produced analysis/advice may be sent to the
  pharmacy **over email and/or WhatsApp** (likely Supabase email / WhatsApp
  Business API or similar). No delivery channel is built or chosen yet.
- **AI integration (possible)** — an AI layer could summarize/interpret
  analyses and help draft the advice. Nothing is built or decided.
- **Advanced user model (possible)** — beyond the current simple
  authenticated-user + superadmin split: e.g., client organizations,
  pharmacy accounts, per-client data scoping, billing/plans, operator vs
  owner permissions. None of it is designed yet.
- **Implications for the current codebase** — today's superadmin full-control
  and export/modal flows are a natural foundation, but anything built now
  should favor the generic primitives (datasets owned by a user, admin
  traversal, export/analysis) rather than hard-coding pharmacy-specific
  concepts until the meeting clarifies the model.

## Roadmap

- **Phase 5 (done):** compliance — classification (template sensitivity →
  dataset), retention (`retention_policies` + `archive/purge` + weekly sweep),
  DSR (export/delete), terms acceptance, `SECURITY.md`, `scripts/e2e-compliance.mjs`.
- **Phase 5.5 (done):** reports UI — operator `Reports` module
  (`app/(app)/reports`: list + `new` composer + `[id]` viewer + `[id]/edit`
  revise; `lib/reports.ts` + `lib/actions/reports.ts` + `components/reports/*`),
  pharmacy-facing read side via existing `effective_report_access` RLS,
  `scripts/e2e-reports.mjs`.
- **Phase 6 (next):** scale — KPI lookups via `_sf_template_key_map` only (no
  hardcoded storage keys), performance indexes, pagination, op-log pruning.

- **Phase 7 (planned, NOT implemented):** installable PWA — `manifest.ts` +
  icons + service worker; free push notifications later via Web Push/VAPID
  (browser push service, no paid provider). Push triggers deferred by
  decision.
- **Next (unconfirmed):** decide the pharmacy service model after the
  stakeholder meeting — user/tenant model, advice workflow, email/WhatsApp
  delivery, and optional AI assist. Update these specs once the picture is
  full.