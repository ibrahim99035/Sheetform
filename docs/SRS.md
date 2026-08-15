# SiroQ — Software Requirements Specification (SRS)

> **Version:** 1.0 · **Date:** 2026-08-14
> **Status:** Current, reflecting the implemented system as of this date.
> Companion document: `docs/SPECS.md` (product/architecture specs and roadmap).

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements of
**SiroQ**, a web application for uploading, browsing, analyzing, and
transforming CSV/Excel spreadsheets, with multi-user data isolation and a
superadmin role. It describes the system as implemented.

### 1.2 Scope

SiroQ provides:

- Drag-and-drop upload of `.csv`, `.xlsx`, `.xls` files.
- Client-side preview with column-type detection and confirmation.
- Asynchronous, background import of the full file into a database-backed
  dataset (with live status updates).
- A virtualized, sortable, filterable data table with inline cell editing.
- Transforms (rename column, filter rows, remove duplicates, edit cell) with
  full undo/redo and an operation audit trail.
- Column statistics and group-by aggregations with charts.
- CSV/XLSX export of the current view or download of the original file.
- Email/password authentication with per-user private data.
- A superadmin role for cross-user administration.

Out of scope (planned or unconfirmed, see `docs/SPECS.md` roadmap): PWA
installation, pharmacy-specific service model, AI assistance, email/WhatsApp
delivery of advice.

### 1.3 Definitions and acronyms

| Term | Definition |
| --- | --- |
| Dataset | A single imported spreadsheet: metadata (`datasets`), rows (`dataset_rows`), column stats (`dataset_column_stats`), operations (`dataset_operations`). |
| Column def | `{key, label, type}` describing a column. `key` is a stable storage key derived from the header; `type` is one of `string`, `numeric`, `date`, `boolean`. |
| View | A persisted filter + sort combination applied to a dataset. |
| Operation | A recorded transform (rename / filter / dedupe / edit) with payload and inverse payload. |
| Superadmin | A user in `admin_users` with cross-user access. |
| RPC | Postgres function invoked via the Supabase PostgREST `rpc` endpoint. |
| RLS | Row Level Security. |

### 1.4 References

- `docs/SPECS.md` — architecture, schema, security model, roadmap.
- `supabase/migrations/20260810180000_init.sql`, `20260811120000_admin.sql` —
  canonical schema and DB functions.
- `README.md` — setup, scripts, environment.

---

## 2. Overall description

### 2.1 Product perspective

SiroQ is a standalone web application. It is a **new product**, not a
component of a larger system. It depends on external services:

| Service | Use |
| --- | --- |
| Supabase (Postgres + Auth) | Data storage, email/password auth, RLS |
| Supabase Storage | Private `uploads` bucket for original files |
| Supabase Realtime | Live dataset status / list updates |
| Supabase Edge Functions (Deno) | Background import pipeline (`import-dataset`) |
| Supabase DB Webhooks | Trigger import on dataset insert |

### 2.2 Product functions

1. **Account management** — sign up, sign in, sign out (email/password).
2. **Upload & import** — file selection, preview, type confirmation, upload,
   background parse/import with live status (`pending` → `processing` →
   `ready`/`error`).
3. **Data browsing** — windowed virtualized table; sort by column; filter by
   column/operator; live matching-row count; inline cell editing.
4. **Transforms** — rename column, delete matching rows (filter), remove
   duplicates, edit cell; each reversible (undo/redo); per-operation audit.
5. **Analysis** — per-column statistics; group-by aggregation (count/sum/avg,
   top-N, min group size) rendered as bar chart + table.
6. **Export** — CSV or XLSX of the current view (filters + sort applied), or
   the original uploaded file.
7. **Administration** — superadmin user list, per-user dataset list, open/edit/
   export any dataset, audited with the acting user id.
8. **Appearance** — light/dark theme with no-flash initialization; responsive
   from 320px (mobile-first, 44px touch targets).

### 2.3 User classes and characteristics

| Role | Description |
| --- | --- |
| Anonymous | Can view landing page, sign up, sign in. Cannot access datasets. |
| Authenticated user (owner) | Full control over their own datasets; no access to others'. |
| Superadmin | All capabilities of an authenticated user, plus the admin panel and cross-user access to any dataset. Elevated only via the service-role key (script). |

### 2.4 Operating environment

- **Client:** modern evergreen browser (mobile + desktop), ≥320px viewport
  width, touch and pointer input.
- **Server:** Node.js (Next.js 16, App Router, Turbopack); Deno for the Edge
  Function.
- **Database:** PostgreSQL via Supabase.
- **Deployment:** Vercel.

### 2.5 Design and implementation constraints

- Next.js 16 conventions (the project's `next` package documents breaking
  changes; consult `node_modules/next/dist/docs/`).
- DB functions are SECURITY INVOKER and rely on RLS for authorization.
- Dynamic SQL is built only from `quote_literal`-escaped values and jsonb
  object keys (never identifiers) — injection must remain impossible.
- Edge Function cannot import app TS modules; coercion/stats logic is mirrored
  there (drift risk is a known constraint).
- Private storage bucket `uploads`, paths rooted at `{owner_id}/...`.
- Max import size: 1,000,000 rows per dataset (client estimate + server-enforced).

### 2.6 Assumptions and dependencies

- Supabase project exists with URL + anon key (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and service-role key
  (`SUPABASE_SERVICE_ROLE_KEY`) on the server.
- Migrations applied via `scripts/push-migrations.mjs`; DB webhook registered
  via `scripts/create-webhook.mjs`; `WEBHOOK_SECRET` set for the Edge Function.
- Email confirmation may be enabled; signup without session redirects to a
  "check your email" message.

---

## 3. Specific requirements

### 3.1 External interface requirements

#### 3.1.1 User interfaces

| Page | Route | Purpose |
| --- | --- | --- |
| Landing | `/` | Marketing + sign up / sign in links. Redirects to `/datasets` when authenticated. |
| Login | `/login` | Email/password sign-in (server action). |
| Signup | `/signup` | Email/password sign-up (server action). |
| Datasets | `/datasets` | List of the user's datasets with live updates and status badges. |
| New dataset | `/datasets/new` | Upload flow (dropzone → preview → import). |
| Dataset workspace | `/datasets/[id]` | Data / Analyze / Activity tabs. |
| Admin | `/admin` | Superadmin-only user table + per-user files dialog. |

Global: theme toggle, toasts (bottom-right, safe-area aware), responsive nav.

#### 3.1.2 API / RPC surface

See `docs/SPECS.md` "Key DB functions" and the migrations for signatures. The
app additionally exposes `GET /api/datasets/[id]/export?format=csv|xlsx|original&view=...`.

#### 3.1.3 Storage

Private bucket `uploads`; object paths `{owner_id}/...`; signed URLs (10 min)
for original-file export; RLS matches first path segment to `auth.uid()` or
superadmin.

### 3.2 Functional requirements

#### FR-1 Authentication (email/password)

| ID | Requirement |
| --- | --- |
| FR-1.1 | The system shall allow sign-up with a valid email and a password of at least 8 characters. |
| FR-1.2 | The system shall sign the user in with email + password and redirect to `/datasets`. |
| FR-1.3 | The system shall support sign-out from the app shell. |
| FR-1.4 | When email confirmation is enabled, sign-up with no session shall instruct the user to confirm their email. |
| FR-1.5 | Middleware (`proxy.ts`) shall redirect unauthenticated users away from `/datasets*` to `/login`, and authenticated users from `/login`/`/signup` to `/datasets`. |
| FR-1.6 | The system shall refresh the Supabase session cookie on requests. |

#### FR-2 Dataset creation / upload

| ID | Requirement |
| --- | --- |
| FR-2.1 | The system shall accept `.csv`, `.xlsx`, and `.xls` files via click or drag-and-drop. |
| FR-2.2 | The system shall reject unsupported types with a clear message. |
| FR-2.3 | The system shall parse a preview (headers + first 50 data rows) on the client and infer each column's type (string/numeric/date/boolean). |
| FR-2.4 | The system shall let the user edit column labels and override inferred types, and choose among sheets when multiple populated sheets exist. |
| FR-2.5 | The system shall reject files with no data rows beyond the header, empty sheets, or estimated rows above 1,000,000. |
| FR-2.6 | On confirm, the system shall upload the file to the user's private storage folder and insert a `pending` dataset row with the confirmed column defs. |
| FR-2.7 | The dataset name shall default to the file base name (optionally overridden). |

#### FR-3 Background import

| ID | Requirement |
| --- | --- |
| FR-3.1 | A DB webhook (trigger on `datasets` INSERT) shall invoke the `import-dataset` Edge Function with the webhook secret. |
| FR-3.2 | The function shall claim the dataset (`pending` → `processing`), parse the stored file using the stored sheet name and column defs, and coerce each value by declared type (non-matching values become null). |
| FR-3.3 | Rows shall be inserted in chunks (500) with concurrency 8 using upsert on `(dataset_id, row_index)`; empty rows are skipped; `row_index` is sequential from 1. |
| FR-3.4 | The function shall compute per-column stats over the full dataset and upsert them. |
| FR-3.5 | On success, the dataset shall flip to `ready` with its `row_count`; on any error, to `error` with a message. |
| FR-3.6 | A `pending` dataset with no corresponding processing run shall remain visible as pending (re-upload guidance shown). |
| FR-3.7 | The dataset list and workspace shall update live via Realtime when status/rows change. |

#### FR-4 Data table

| ID | Requirement |
| --- | --- |
| FR-4.1 | The system shall render the dataset rows in a windowed virtualized table (200-row pages, infinite scroll, estimated 36px rows, overscan 12). |
| FR-4.2 | The header row and `#` (row_index) column shall remain sticky. |
| FR-4.3 | The user shall sort by a column (asc → desc → none) via header click. |
| FR-4.4 | The user shall filter by column + operator (contains, is, is not, >, ≥, <, ≤, is empty, is not empty), with type-aware validation for numeric/date values. |
| FR-4.5 | Active filters shall appear as removable chips; filters + sort combine into the view used for row fetch, count, and export. |
| FR-4.6 | The footer shall show the live matching-row count and load state. |
| FR-4.7 | The user shall edit a cell by double-click (pointer) or tap (touch) and commit on Enter/blur; Escape cancels. |

#### FR-5 Transforms with undo/redo

| ID | Requirement |
| --- | --- |
| FR-5.1 | The system shall support: `rename_column`, `filter_rows` (delete matching), `dedupe`, `edit_cell`. |
| FR-5.2 | Each operation shall be applied via `apply_operation`, recorded with payload + inverse payload and the acting `user_id` in `dataset_operations`. |
| FR-5.3 | Column stats shall be recomputed after every operation. |
| FR-5.4 | The user shall undo the most recent applied operation and redo the most recently undone one (from the Data or Activity tab). |
| FR-5.5 | `filter_rows` / `dedupe` shall soft-delete rows (`deleted_at`); undo restores them. |
| FR-5.6 | `rename_column` shall rewrite `data` keys and `column_defs`, rejecting collisions and missing targets. |
| FR-5.7 | `edit_cell` shall coerce the raw input to the column type before persisting and store the prior value for inverse. |
| FR-5.8 | The Activity tab shall list operations with type icon, description, applied time, and Applied/Undone status. |

#### FR-6 Analysis

| ID | Requirement |
| --- | --- |
| FR-6.1 | The system shall display per-column statistics: type, distinct count, empty (null) count, and min/max/avg/sum for numeric columns. |
| FR-6.2 | The system shall compute group-by aggregations on live rows: group column + agg function (count/sum/avg) + optional numeric agg column + top-N (1–500) + minimum group size. |
| FR-6.3 | Results shall render as a bar chart and a result table (group, rows, value). |
| FR-6.4 | Errors (e.g. invalid agg column) shall surface to the user. |

#### FR-7 Export

| ID | Requirement |
| --- | --- |
| FR-7.1 | The system shall export the current view (filters + sort applied) as CSV (streamed, UTF-8 BOM, proper escaping) or XLSX. |
| FR-7.2 | The system shall allow download of the original uploaded file via a signed URL. |
| FR-7.3 | Export shall require authentication and shall respect ownership / superadmin. |
| FR-7.4 | Export file names shall derive from the original file base name with `-export.csv` / `-export.xlsx` suffixes. |

#### FR-8 Superadmin

| ID | Requirement |
| --- | --- |
| FR-8.1 | Elevation to superadmin shall be possible only with the service-role key (`scripts/add-admin.mjs`); authenticated users cannot insert into `admin_users`. |
| FR-8.2 | The admin panel (`/admin`) shall be accessible only to superadmins and shall list all users (email, files count, joined, last active). |
| FR-8.3 | The admin shall open any user's files in a dialog and navigate into the workspace with full edit/export control. |
| FR-8.4 | Admin actions shall be audited with the acting superadmin's `user_id` in `dataset_operations`. |
| FR-8.5 | Owner RLS policies shall be extended with `or is_superadmin()` for datasets, rows, stats, operations, and storage. |
| FR-8.6 | Admin RPCs shall self-guard with `if not is_superadmin() then raise exception 'FORBIDDEN'`. |

#### FR-9 Appearance & responsiveness

| ID | Requirement |
| --- | --- |
| FR-9.1 | The system shall support light and dark themes with a no-flash inline init script and persistence in `localStorage`. |
| FR-9.2 | The UI shall be usable down to 320px: 44px touch targets, no horizontal body overflow, responsive shell/filters/charts, safe-area-aware toasts, `viewport-fit=cover`. |
| FR-9.3 | Theme-aware inputs (autofill/caret colors) shall render correctly in both themes. |

### 3.3 Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 (Security) | RLS enforced on all data tables and storage; ownership via `owner_id = auth.uid()`; superadmin via SECURITY DEFINER `is_superadmin()`. |
| NFR-2 (Security) | All dynamic SQL constructed only from quoted literals and jsonb keys — no identifier injection. |
| NFR-3 (Security) | Service-role key used only server-side / in scripts, never shipped to the client. |
| NFR-4 (Performance) | Table fetch is windowed (200 rows) with infinite scroll; group-by limited to 500 groups; import chunked/concurrent. |
| NFR-5 (Scalability) | Supports datasets up to 1,000,000 rows with soft-delete + partial index on live rows. |
| NFR-6 (Reliability) | Import pipeline is asynchronous with explicit statuses; failed imports record `error_message`. |
| NFR-7 (Maintainability) | TypeScript strict; mirrored client/Edge logic documented as a known constraint; unit tests for coercion/parse/inspect/stats. |
| NFR-8 (Auditability) | Every transform is persisted with user, payload, inverse, applied time, and undone time. |

### 3.4 Test requirements

The current repository ships unit tests (`vitest`) covering:

- `coerce` — value coercion, date parsing, type inference, key generation.
- `parse` — CSV/XLSX preview parsing and type inference.
- `inspect` — CSV/XLSX file inspection decisions (single / auto_populated / picker / error).
- `stats` — column statistics computation and stats-row mapping.

Build/lint gates: `npm run lint`, `npm run build`.

---

## 4. Appendix

### 4.1 Data model summary

| Table | Key columns |
| --- | --- |
| `datasets` | `id, owner_id, name, original_filename, storage_path, status, error_message, row_count, column_defs jsonb, sheet_name, created_at, updated_at` |
| `dataset_rows` | `id, dataset_id, row_index, data jsonb, deleted_at, unique(dataset_id, row_index)` |
| `dataset_column_stats` | `dataset_id + column_key (PK), min, max, avg, sum, distinct_count, null_count, computed_at` |
| `dataset_operations` | `id, dataset_id, user_id, operation_type, payload, inverse_payload, applied_at, undone_at` |
| `admin_users` | `user_id (PK), created_at` |

### 4.2 Environment variables

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client+server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client+server | Anon (client) key |
| `SUPABASE_SERVICE_ROLE_KEY` | server/scripts | Service-role key (never client) |
| `NEXT_PUBLIC_SITE_URL` | server | Base URL for auth redirects |
| `WEBHOOK_SECRET` | Edge Function | Guards the import webhook |
| `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` | scripts | Management API access |

### 4.3 Known limitations

- Column types are fixed at import; editing a value does not re-type the column.
- Undo/redo stack is per-dataset and unbounded in storage (UI shows latest 100).
- The Edge Function mirrors `lib/coerce.ts` / `lib/stats.ts` logic and can drift.
- Original-file export requires the service-role key on the server (admin client).
