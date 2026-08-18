# SiroQ — Technical workflow

> Technical companion to `04-technical-workflow.drawio`. It shows exactly what the
> system already does, how it does it (real function names, real tables), and —
> honestly — what is **not** wired yet. We are not claiming "done"; we are grounding
> the scope conversation in working software you can touch in the demo.

Companions: `05-capabilities-brief.md` (built / pending / open-terms matrix),
`../SPECS.md` + `../OPS.md` (full engineering detail).

---

## 0. The running demo (prove it, don't say it)

| Proof point | Value |
| --- | --- |
| Login | `browser-owner@siroq.test` (superadmin in org **Browser Test Pharmacy**, approved branch **Main**) |
| Application | **Browser Q3 Sales v2** — `/applications/fc3e7b86-cd67-4221-878f-f281e657e881` |
| Dataset | `sales.csv` (4 rows) — `/applications/<app>?dataset=658a11e3-0487-4881-9caa-b18c44221648` |
| Published reports | `/reports/9cc61903-c67b-4787-9dc7-8aedd032a105` and `/reports/f682f3b9-d982-488b-99f4-c077e8e52b24` |
| Local | `npm run dev` → http://localhost:3000 |

30-second demo script:
1. Open the application workspace → pick `sales.csv` → **Analyze** tab.
2. **Add to report** on *Column statistics* (table block), **Add chart** on the
   group-by aggregation (bar/line/area/pie), run the **Engine** and **Add to
   report** (insight block).
3. Watch every block render **inline, fully visible** in the report builder
   (chart, table, markdown — no placeholder text), then hit **Preview report**
   to see the exact published page before it exists.
4. **Publish** → you land on `/reports/<id>` rendering the same components.

---

## 1. Ingestion & application workspace (diagram page 1)

### 1.1 Upload
- Operator adds a file to an application via `add_application_file` (server
  action in `lib/actions/`). It writes two rows:
  - `datasets(owner_id, name, original_filename, storage_path, status='pending', column_defs, sheet_name, template_code)`
  - `application_files(application_id, dataset_id, original_filename, storage_path, sheet_name, column_defs)`
- The `import-dataset` Edge Function then runs the import pipeline:
  `parse` (`lib/parse.ts`) → `coerce` (`lib/coerce.ts`, type inference +
  `coerceValueDetailed/test`) → `chunkedInsert` → `computeStats`
  (`supabase/functions/import-dataset/index.ts`), refreshing
  `dataset_column_stats` and flipping status to `ready`.
- Pre-existing issue, surfaced in the demo not as a crash but as low-confidence
  metrics: this smoke dataset's `column_defs` carry **no `role` fields**, so
  `_sf_dataset_key_map` returns `{}` and the engine's KPI/rank RPCs return `{}`
  / fallbacks. Quality profile is unaffected (row counts + column stats are
  real). Assigning roles is a **pending** item — see §5.

### 1.2 Workspace (`/applications/[id]?dataset=<id>`)
- `app/(app)/applications/[id]/page.tsx` reads `searchParams.dataset` and hands
  `initialDatasetId` to `ApplicationWorkspace`.
- `getDatasetWorkspaceData(datasetId)` (server action) returns
  `{ dataset, stats, ops, analysis }` in one shot for the embedded
  `DatasetWorkspace`.
- Tabs: **Data** (rows), **Analyze** (stats + group-by), **Engine**
  (deterministic analysis), **Activity** (operation history).

### 1.3 Operations
- `apply_dataset_operation` RPC supports `edit_cell`, `add_column`,
  `filter_rows`, `dedupe` (add-column added in this iteration); each writes a
  `dataset_operations` row carrying `payload` + `inverse_payload` so any
  operation is undoable.
- `undo_dataset_operation` rewinds the inverse payload and marks `undone_at`.

---

## 2. Analysis engine (diagram page 2) — every analysis becomes a block

### 2.1 Analyze tab (lightweight, interactive)
- **Column statistics** card reads `dataset_column_stats` → **Add to report**
  emits a `table` block: `body = { columns: [...], rows: [[...]] }`.
- **Group-by aggregation** calls the `group_by` RPC
  (`group_by(dataset_id, group_col, agg_col, agg_fn, top_n, min_count, view)`,
  filter-aware via `_sf_filter_condition`) → **Add chart** emits
  `body = { series: [{bucket, value}], metric }` with
  `chart_type = bar|line|area|pie`; **Add table** emits the `columns`+`rows`
  table shape.

### 2.2 Engine tab (deterministic, no LLM)
- `runDatasetAnalysis` (`lib/actions/analysis.ts`) fans out **12 guarded RPCs**
  in parallel (`Promise.all`):
  `_sf_dataset_key_map`, `quality_profile`, `dataset_kpis`, `time_series`,
  `compare_periods`, `refund_rate`, `concentration`, `rank_samples` ×3,
  `time_pattern` ×2.
  - `guardedRpc` turns any RPC error into the supplied fallback, so one flaky
    RPC degrades gracefully instead of failing the run (this is exactly how the
    `quality_profile` format-arg bug surfaced as "0 rows" instead of a crash —
    fixed in this iteration; the engine now reports **4 rows analyzed,
    100/100 excellent** on the demo dataset).
- `runAnalysis(payload)` (`lib/analysis/`) renders roles, data quality, KPIs,
  insights and a markdown narrative (`lib/analysis/markdown.ts`). Result is
  upserted to `dataset_analyses(dataset_id, roles, report, markdown)`.
- **Add to report** emits an `insight` block: `body = { markdown }` + title.

> Why this matters: the whole "advisor at scale" value chain is
> **user-clickable** from a single screen. Nobody waits on an LLM, and every
> produced artifact is a persisted block you can reorder, delete and publish —
> nothing is a static screenshot.

---

## 3. Report building blocks & publish (diagram page 3)

### 3.1 Block model (`report_blocks`)
- Columns: `id, application_id (FK cascade), kind (check chart|table|insight|text),
  title, body jsonb, chart_type (check bar|line|area|pie), branch_ids uuid[],
  sort_order, created_at`. RLS: superadmin-only (operator IS the admin here).
- RPCs: `add_report_block(app_id, kind, title, body, chart_type, branch_ids)`,
  `reorder_report_blocks(app_id, ordered_ids)`, `delete_report_block(id)`.
- Client reads via the PostgREST list (RLS), `getReportBlocks(appId)` → ordered
  `ReportBlockRow[]` from `lib/actions/report-blocks.ts`.

### 3.2 Builder (`components/report-builder.tsx`)
- Each block card shows kind badge + `chart_type` badge + title, move up/down,
  remove — **and now the real body rendered inline** via the shared
  `ReportBlockBody` (chart / table / markdown / rich-text all render — what you
  see is what will be published).
- Move/remove use optimistic cache updates (`['report-blocks', appId]` key) with
  RPC rollback on failure.
- Custom blocks: tiptap `RichTextEditor` → `text` block with a `JSONContent`
  `body.text` document.

### 3.3 Preview + publish
- **Preview report** (`components/report-preview.tsx`) renders the exact head-to-
  tail page a publish will produce — title, components in `sort_order`, scope
  badge (`org-wide` or branch names) — with zero server round-trip.
- `publishReport` (`lib/actions/reports.ts`) maps each block to a
  `report_components` row:
  - `body` carries `chart_type` merged in for chart blocks,
  - `visibility = org | branch` (branch when `branch_ids.length > 0`),
  - `branch_ids` only on branch-scoped rows,
  - report links `application_ids = [application.id]`, status `published`.
- Landing page `/reports/<id>` (`components/reports/report-viewer.tsx`) renders
  the same components through the **same** `ReportBlockBody` — so the pre-publish
  preview and the published page are pixel-identical by construction.

### 3.4 Delivery (out of the demo, wired in repos)
- `queue_report_deliveries(report_id, kind)` → `deliveries` rows per enabled
  `branch_profiles.email_delivery | whatsapp_delivery`; `deliver-reports` Edge
  Function renders + sends with status machine
  `queued → processing → delivered | failed | skipped`, ≤3 attempts,
  `retry_deliveries(report_id)` re-queues. PDF export at
  `/api/reports/<id>/export/pdf`.

---

## 4. Governance recap

- `organizations → branches → users`; per-application `branch_id` scoping;
  block `branch_ids` decide **who sees a component** after publish.
- RLS everywhere on reads (client), superadmin-only on `report_blocks`,
  role-gated RPCs (`is_superadmin()`, pharmacist branch checks). No secrets in
  client bundles; env split (`NEXT_PUBLIC_*` vs server).
- Migrations tracked in `public._applied_migrations`, pushed via
  `node scripts/push-migrations.mjs` (idempotent, applied separately from code).

---

## 5. Pending / honest gaps

| # | Gap | Relevance |
| --- | --- | --- |
| 1 | **Admin dashboard + nav** (Phase 3): sidebar admin (Applications + Users) on `/admin`, non-admin nav (Home / About / Contact / Profile), `app/page.tsx` authed redirect split | "Your console" — scope/price lever; demo today is application-first from the start |
| 2 | **Inline upload button** on the application File list (`add_application_file`) | Right now files are attached through the existing dataset attachment flow; a one-click add-on is cheap |
| 3 | **Column role inference / assignment** for deterministic metrics | Until defs carry roles, engine KPIs ("gross revenue", "COGS", …) show "— / low"; quality profile + group-by are already meaningful |
| 4 | Delivery contract details (email vs WhatsApp, schedules, multi-recipient per branch) | Currently: per-branch profile flags, status machine, retry, PDF |

Nothing above is a stuck problem — each is a scoped, planned increment.

---

## 6. Opening questions for the buyer

1. Who operates the console day-to-day — one association admin, or per-branch
   pharmacists with read access to scoped blocks?
2. What does a "monthly cycle" look like for you — N files × M pharmacies; which
   of blocks 1–4 do you want this quarter?
3. Are blocked/as-pending items 1–4 must-haves for pilot, or can the pilot
   start before them?
4. Delivery: email only, or WhatsApp on your own sender?