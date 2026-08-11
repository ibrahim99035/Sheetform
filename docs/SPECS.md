# Sheetform — Product Specs

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
| Deployment | Vercel (`https://sheetform-eight.vercel.app/`) |

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

## Migrations

| File | Contents |
| --- | --- |
| `20260810180000_init.sql` | tables, storage bucket + policies, helper/read/analyze/transform functions, grants, RLS, realtime publication |
| `20260811120000_admin.sql` | `admin_users`, `is_superadmin()`, `or is_superadmin()` on all owner/storage policies, `admin_list_users` / `admin_list_datasets` |

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

## Environment

`.env.example` documents: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`. Local `.env.local` (gitignored) mirrors this;
Vercel has its own env set.

## Mobile testing matrix

Playwright (playwright-core, `--no-sandbox` Chromium) against localhost and
Vercel: 320×568, 360×640, 390×844, 844×390 (landscape), 768×1024, 1024×768,
1280×800 — light + dark, touch on all but the last. Checks: no body
horizontal overflow, sticky `#` column after horizontal scroll, header/nav
visible, tap-to-edit opens a focused input, analyze chart renders without
overflow.

## Roadmap

- **Phase 7 (planned, NOT implemented):** installable PWA — `manifest.ts` +
  icons + service worker; free push notifications later via Web Push/VAPID
  (browser push service, no paid provider). Push triggers deferred by
  decision.