# Application-Centric Admin/Operator Workflow — Implementation Plan

## Goal

Turn the Application page into the single workspace: datasets + analysis + report
building. Admin (the operator) gets a sidebar dashboard (Applications + Users);
non-admins get Home/About/Contact/Profile. Every analysis result (stats,
group-by aggregation, time series, engine insight) becomes an **addable building
block**, persisted to a new `report_blocks` table, and later published into report
components.

## Decisions (from Q&A)

- Non-admin nav: Home / About / Contact / Profile.
- Admin nav: Dashboard (Applications + Users) with a sidebar.
- Building blocks: NEW `report_blocks` table (persisted), not client-only drafts.
- Add-column capability IS in scope (computed formula columns + blank typed columns).
- Filter-aware analysis RPCs ARE in scope (current `view.filters` honored by
  `group_by` and engine functions so blocks capture the filtered subset).
- Multiple chart types ARE in scope (recharts bar/line/area/pie in report viewer).

## Feasibility findings (grounded in code)

- `apply_operation` today only handles `rename_column | filter_rows | dedupe | edit_cell`
  (`supabase/migrations/20260814140000_op_timeout.sql:60–186`). No add-column op.
- `group_by` and engine RPCs take **no filter/view param** (see `group_by` at
  `20260810180000_init.sql:416`). `_sf_filter_condition(view, defs)` already exists
  to build a WHERE clause — thread an optional `p_view` param through them.
- Report `BodyView` renders chart-ish content only as a compact bar list via
  `body.series` (`components/reports/report-viewer.tsx:50`). `recharts ^3.10.1` is
  installed — add real bar/line/area/pie renderers keyed by a persisted `chart_type`.
- `datasets.column_defs` (jsonb) + `dataset_rows.data` (jsonb per-row) is the schema
  to extend for add-column; `_sf_recompute_column_stats` recalculates stats.
- `add_application_file` (`20260816100000_application_add_file.sql`) is org-member
  guarded; needs `or public.is_superadmin()` for admin uploads.
- `publish_report`/`revise_report` are superadmin-only RPCs persisting
  `report_components`; block → component mapping on publish.

## Phases

### Phase 1 — Migration `supabase/migrations/20260816130000_app_centric.sql`

1. `report_blocks` table:
   - `id uuid default gen_random_uuid()`, `application_id uuid` (FK→applications,
     idx, cascade), `kind text`, `title text`, `body jsonb`, `chart_type text`,
     `branch_ids jsonb default '[]'`, `sort_order int default 0`, timestamps.
   - RLS: superadmin-only (`is_superadmin()`), grants to `authenticated`/`service_role`.
   - RPCs (superadmin-guarded):
     - `add_report_block(p_application_id, p_kind, p_title, p_body, p_chart_type)`
     - `reorder_report_blocks(p_application_id, p_ordered_ids uuid[])`
     - `delete_report_block(p_block_id)`
2. `add_column` operation in `apply_operation`/`undo_operation`/`redo_operation`:
   - `apply_operation` branch for `p_operation = 'add_column'`:
     - params `{name, label, type, formula, derive_from}`.
     - collision check; key-sanity check (`^[a-z_][a-z0-9_]*$`).
     - computed: validate formula tokens (`+-*/()`, spaces, `_`, `[a-zA-Z0-9]`),
       build per-row `(data->>'key')::numeric` expression, full-table UPDATE.
     - blank: append key to column_defs, leave values null.
     - recompute stats for the new column.
     - inverse payload `{name, key}` → undo removes key from defs + `data`.
   - `undo_operation` new `when 'add_column'` branch.
3. Filter-aware analysis (optional `p_view jsonb default '{}'::jsonb`) on:
   - `group_by`
   - engine RPCs: `dataset_kpis`, `time_series`, `rank_samples`, `refund_rate`,
     `concentration`, `time_pattern`, `branch_ranking`, `quality_profile`.
   Each redefined with the extra defaulted param; WHERE clause builds from
   `_sf_filter_condition(coalesce(p_view,'{}'::jsonb), defs)` when non-empty.
4. Superadmin bypass in `add_application_file`.

### Phase 2 — Client data layer

- `lib/dataset-api.ts`: `fetchGroupBy` gains optional `view?: ViewState`; add
  `addColumn(datasetId, opts)` helper calling `apply_operation(..., 'add_column', ...)`.
- `lib/actions/reports.ts` or new `lib/actions/report-blocks.ts`:
  `getReportBlocks`, `addReportBlock`, `reorderReportBlocks`, `deleteReportBlock`,
  mapping server actions to the RPCs (superadmin-only keys returned).

### Phase 3 — New pages & nav

- `components/admin-sidebar.tsx` + `app/(app)/admin/layout.tsx` (sidebar shell).
- Admin dashboard: `app/(app)/admin/page.tsx` (overview: apps list + users list),
  `app/(app)/admin/applications/page.tsx`, reuse `AdminUsers` for users.
- Non-admin pages: `app/(app)/about/page.tsx`, `contact`, `profile`.
- `app/(app)/layout.tsx`: branch nav (superadmin → admin sidebar links; otherwise
  Home/About/Contact/Profile).
- `app/page.tsx`: redirect superadmin → `/applications`, others → `/profile`.

### Phase 4 — Workspace restructure

- New server action `getDatasetWorkspaceData(datasetId)` mirroring
  `/datasets/[id]/page.tsx` data (dataset + column stats + operations + analyses).
- `components/application-workspace.tsx`:
  - Datasets section (application_files) w/ inline upload via `add_application_file`.
  - Embedded `DatasetWorkspace` for selected dataset (`?dataset=<id>`), `backHref`.
  - Publish flow → creates report via blocks.
- `components/report-builder.tsx`: lists `report_blocks` w/ reorder/remove/publish.

### Phase 5 — Add-block wiring & chart types

- `dataset-workspace.tsx`: `onAddBlock` prop; thread to Analyze + Engine tabs.
- `analyze-tab.tsx`: Add buttons on stats card, group-by chart/table.
- `engine-tab.tsx`: Add-block on the generated markdown insight.
- `report-viewer.tsx` `BodyView`: new `ChartView` branch — recharts
  Bar/Line/Area/Pie from `body.series` + `chart_type`, compact-bar-list fallback.
- `report-composer`: allow `chart_type` + series in chart/table component bodies.

### Phase 6 — Verification

- `npm run check` (all tests green), `npm run typecheck`, `npm run lint`.
- Add coverage: SQL-level/script-level for add_column + undo (extend
  `scripts/` harness style of `e2e-analysis.mjs`).
- Browser-verify admin flow in app `fc3e7b86-cd67-4221-878f-f281e657e881`:
  upload → filter → add block (agg / analysis / chart w/ type) → publish → view report.
- Keep `nextjs-agent-rules` block intact in AGENTS.md.

## Block → report component mapping (publish)

| block kind | report_components kind | body                          |
|------------|------------------------|-------------------------------|
| chart      | chart                  | {chart_type, series, metric}  |
| table      | table                  | {columns, rows}               |
| insight    | insight                | {markdown/text}               |
| text       | text                   | {text: tiptap doc}            |