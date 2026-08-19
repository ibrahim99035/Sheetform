# SiroQ Pharma BI — Remaining Work Plan

**Status:** Master plan (supersedes the short-scope lists in `AGENTS.md`/memory).
**Audience:** operator/dev team + client-facing delivery tracker.
**Conventions:** files referenced are the current ones; every phase lists concrete files, function names, acceptance criteria, tests, dependencies and risks. Nothing here is committed yet — it is the blueprint for the build sequence.

---

## How to read this plan

Each phase (P2..P8) is an independently ship-able slice. They are ordered by dependency, not by client priority. Every task is tagged with a severity/effort estimate (S/M/L) and a "definition of done" that the implementation must satisfy to close the phase. The last section ("Delivery checklist") is the client-facing handoff checklist.

Legend: **S**=small (<½ day), **M**=medium (½–2 days), **L**=large (2–5 days), **XL**=>5 days.

---

## Current state (verified 2026-08-19)

### What already exists
- **Org model:** `organizations`, `org_profile`, `branches`, `org_members`, `applications`, `deliveries`, `dataset_analyses`, `dataset_operations`, `dataset_column_stats`, `benchmark_aggregates` (migrations `20260814120000_org_model.sql` … `20260819000000_services_catalog.sql`).
- **Data plane:** Supabase RPC path + local-first DuckDB/OPFS path (`lib/db/duckdb.ts`, `lib/datastore.ts`, `components/dataset-workspace.tsx`).
- **Analytics engine:** `lib/analysis/*` — 18 files, pure deterministic modules: roles (`roles.ts`), services catalog + coverage (`services.ts`), orchestrator (`modules.ts`), quality/metrics/insights/Markdown (`quality.ts`, `metrics.ts`, `insights.ts`, `markdown.ts`), 12 runtime modules (rfm, basket, abcXyz, safetyStock, expiry, forecast, benchmark, sales, supplier, geography, budget, stocktake) with full test coverage (159 tests green, tsc+lint clean).
- **UI:** per-dataset workspace with Data/Analyze/Engine/Activity tabs; upload flow with role confirmation (`components/upload-flow.tsx`, `components/preview-table.tsx`); superadmin panel (`app/(app)/admin/page.tsx`).

### Verified gaps (the remaining work)
1. Service-coverage report is computed (`assessServiceCoverage`) but **never rendered or wired into upload** — the "ask the client for missing data" loop is dead code.
2. Geography module emits `markers[]` but **no map is rendered** (no leaflet dependency, no component).
3. Budget lens is **single-dataset only** — budget sheet vs sales-sheet actuals can't be combined across datasets.
4. **No org-level dashboard** — the 9 services are only reachable per-dataset; no client-facing hub.
5. **No in-app training content** (the 9th requested service).
6. Backend hardening items from the audit: `retryImport`, `snapshot_report_kpis` destructiveness, diagnostic RPCs exposed, `.env.local` service-role JWT, PDF export gaps.

---

## Phase 2 — Wire service-coverage into the upload flow ("ask the client for missing data")

> Primary goal: after the client imports a file and confirms column roles, tell them *which of the 9 services this file powers* and *exactly which roles to add* to unlock the rest. This closes the loop on the consultant service model.

### 2.1 Coverage card component — **S**
- **File:** `components/service-coverage.tsx` (new).
- **Behavior:**
  - Props: `roleMap: Partial<Record<ColumnRole, string>>`, optional `onRequestMore?(missing: {role; label}[]): void`.
  - Calls `assessServiceCoverage(roleMap)` from `lib/analysis/services.ts` (pure, safe to call client-side).
  - Renders a compact grid of the 9 services (`SERVICES` order): icon/name (Arabic + English), availability badge (available/partial/needs data), and for unavailable services the list of missing required roles as `roleLabel()` chips.
  - "Ask for this data" button per unavailable service → collects the missing roles into a shared request list → emits `onRequestMore` (Phase 2.2 consumes it).
- **Design rules:**
  - No server round-trip for the assessment itself (input is already in the client bundle via column defs).
  - Reuse existing UI primitives (Card, Badge, Button, Tooltip) — no new component-system dependencies.
- **Tests:** `test/service-coverage-card.test.tsx` (render with a purchases-only role map → suppliers available, sales missing date/product/qty; assert chips).

### 2.2 Upload-flow integration — **S**
- **Files:** `components/upload-flow.tsx`, `components/preview-table.tsx`.
- **Behavior:**
  - After the sheet preview is parsed and before "Import", show the coverage card between the preview table and the confirm button.
  - Derive `roleMap` from the confirmed column defs (`columns?.map(c => [c.role, c.key])`), excluding empty roles.
  - "Request data" emits a summary line appended to the import confirmation (a plain-text checklist shown before commit) and stores it on the dataset once created (see 2.3).
- **Acceptance:** importing a purchases file shows "suppliers: ready", "sales: needs date, product, qty" with a one-tap "Request" that lists the roles in Arabic and English.
- **Regression risk:** keep the existing "createDataset" payload unchanged; the coverage UI is purely additive.

### 2.3 Persist the request — **M**
- **File:** `lib/actions/datasets.ts` + migration `supabase/migrations/2026XXXX000000_dataset_coverservices.sql` (new).
- **Schema (new columns on `datasets`):**
  - `service_coverage jsonb null` — snapshot of `assessServiceCoverage` at import time.
  - `data_requests jsonb null` — the requested missing-role checklist from 2.2.
- **Behavior:**
  - `createDataset` accepts optional `serviceCoverage`, `dataRequests` and stores them.
  - `runAnalysis` (engine + pharmacy path) refreshes `service_coverage` after roles are final.
- **Acceptance:** DB migration is idempotent; existing rows default null; RLS still applies (column added to existing policies; no new table).

### 2.4 Operator "missing-data checklist" view — **M**
- **File:** `components/admin-users.tsx` or a new `components/operator-requests.tsx` inside the superadmin admin page.
- **Behavior:** table of orgs/datasets with `data_requests` non-null → shows the ask list, the org contact, and a "mark sent" toggle (persists per request). This is the consultant's delivery queue.
- **Acceptance:** superadmin sees every client's outstanding data asks in one screen; toggling state survives reload.

---

## Phase 3 — Render the geography lens on a map (Leaflet)

> Primary goal: make the 9th service visual — sales/customer/stocks on a map for the client’s region.

### 3.1 Add dependency — **S**
- **Dependency:** `leaflet` + `react-leaflet` + `@types/leaflet` (or vanilla `leaflet` with a thin React wrapper to stay tree-shakeable). Decision: use `react-leaflet` v5 (React 19 compatible; verify with `npm view react-leaflet peerDependencies` before install).
- Offline caveat: leaflet layers need map tiles (OSM). Document tile provider choice in `docs/OPS.md`; add a non-tile fallback (SVG dot-density grid) when tiles fail (`LeafletMap` catches tile load errors → renders local `ChoroplethFallback`).

### 3.2 `GeographyCard` map integration — **M**
- **Files:** `components/pharmacy-modules.tsx`, new `components/geo-map.tsx`.
- **Behavior:**
  - `GeographyCard` already has `geography.markers[]` ({label, lat, lng, value, units}). Render `<GeoMap markers={...} />` when `markers.length > 0`.
  - `GeoMap` (client-only, dynamically imported via `next/dynamic` with `ssr:false`) renders a circle-marker layer sized by value, tooltip = label + value, and a pane toggle City/Region/Country below the map that switches the underlying bucket list.
  - When no markers: keep the current table + the existing "add latitude/longitude columns" flag.
- **Acceptance:** a dataset with lat/lng renders markers in the browser build; no SSR crash (dynamic import guards `window`), no tile-fail white screen.

### 3.3 Map data seams — **S**
  - Ensure `projectRows` exposes lat/lng for rows that already carry city/region (no coords). Document that the map needs lat/lng (or a geocoder, deferred to Phase 4.5) — do not block P3 on geocoding.

---

## Phase 4 — Org-level client dashboard (the converged hub)

> Primary goal: the client-facing deliverable. One page per organization presenting the 9 services as a dashboard with per-service tabs, each powered by the lenses built in Phase 1 plus the existing RFM/basket/ABC/safety/expiry/forecast/benchmark modules.

### 4.1 Route + navigation — **M**
- **File:** `app/(app)/org/[id]/page.tsx` (new), `app/(app)/datasets/page.tsx` (add an "Organization view" link per org).
- **Behavior:** server component that loads org + its datasets + latest `service_coverage` per dataset; redirects non-members (RLS). Client component shells the tab UI.
- **Acceptance:** only org members can reach the route; non-members get redirect/403.

### 4.2 Dashboard overview tab — **M**
- **File:** `components/org-dashboard.tsx` (new).
- **Behavior:**
  - KPI strip: total revenue, units, customers, months covered (from the union of datasets).
  - Service availability grid (reuse the coverage card from 2.1) with a global "data completeness" %.

### 4.3 Per-service lenses — **M**
- **File:** `components/service-tabs.tsx` (new), `components/service-lens-panel.tsx` (new).
- **Behavior:**
  - Tab per service (9 tabs; disabled + "needs data" tooltip when coverage says unavailable).
  - Each panel renders the matching lens module output for the org (sales/suppliers/geography/budget/stocktake/RFM/basket/ABC/safety/expiry/forecast/benchmark) by running `buildSuite` over the union of the org's datasets (projected rows merged by column role so the same lens works across files).
- **Important rule:** modules stay pure/server-side; the dashboard fetches a single server action per org returning all 12 module results (one pass) rather than 12 round trips.

### 4.4 Cross-dataset budget actuals (the missing-input for the budget tab) — **L**
- **File:** `lib/analysis/modules.ts` (extend), `lib/actions/org-dashboard.ts` (new).
- **Problem today:** budget venue is single-dataset; a budget sheet and a sales sheet are separate datasets.
- **Design:**
  - Add a `combineOrgBudgets(orgDatasets)` helper that maps each dataset through `projectRows`, merges sales-sheet actuals (`period, category, branch → actual`) with budget-sheet targets (`period, category, branch → budget`), then calls `runBudget` once.
  - The budget tab always uses this combined path; the per-dataset budget card still runs the single-dataset path.
- **Acceptance:** budget tab shows variance even when targets and sales live in different files.

### 4.5 Optional: geocoding for the map tab — **L (deferred, non-blocking)**
- If the client has cities/regions but no lat/lng: add a server-side geocoder (Nominatim) with rate-limit + cache table `geocode_cache(place text pk, lat, lon)`. This is explicitly NOT required to close Phase 4; the map tab falls back to the table when no coords.

---

## Phase 5 — In-app training content (تدريب)

> Primary goal: the 9th requested service. It is content, not analytics — but it needs a real route, navigation, and lightweight progress tracking so the client sees it as a product feature.

### 5.1 Content model — **S**
- **File:** `lib/training.ts` (new) + migration `supabase/migrations/2026XXXX000000_training.sql` (new).
- **Schema:** `training_lessons(id, slug, title_ar, title_en, service_id, body_md, order_index, visibility)` + `training_progress(user_id, lesson_slug pk, completed_at)`.
- Seed content for all 9 services (each lesson explains: what the service does, what data it needs, how to read the outputs, a worked example, common mistakes). Write the Arabic copy in the repo (`docs/training/*.md`), compile to the table in the migration.
- **Acceptance:** 9+ seeded lessons, idempotent seed migration, RLS.

### 5.2 Training route + UI — **M**
- **Files:** `app/(app)/training/page.tsx` (new), `app/(app)/training/[slug]/page.tsx` (new), `components/training-list.tsx` (new), `components/lesson-view.tsx` (new).
- **Behavior:** lesson list grouped by service; lesson view renders Markdown (reuse `lib/analysis/markdown.ts` conventions or a safe renderer — no raw HTML), a "Mark complete" button, and per-org completion meter on the dashboard.

### 5.3 Tie-in with coverage — **S**
- The "needs data" chips on any dashboard/upload coverage card link to the relevant training lesson.

---

## Phase 6 — Backend hardening (from the 2026-08-19 audit)

> These are correctness/security/ops fixes flagged in the audit. They are lower-priority than P2–P5 but must be done before client data scales.

### 6.1 `retryImport` robustness — **M**
- **File:** `lib/actions/datasets.ts`, `supabase/functions/import-dataset`.
- **Problem:** partial-failure states on retry can double-insert rows or skip idempotency keys.
- **Fix:** make the import idempotent per `(dataset_id, batch_id)`; on retry, truncate the dataset's rows first within a transaction, then re-run. Add a test that simulates a mid-import failure (injectable failure in the function) and asserts the dataset ends consistent.

### 6.2 `snapshot_report_kpis` destructiveness — **M**
- **File:** SQL migration + callers in `lib/actions/report-blocks.ts`.
- **Problem:** snapshot RPC deletes existing KPI snapshot rows before inserting; a failed insert loses prior data.
- **Fix:** change to upsert (insert on conflict) keyed on `(report_id, bucket)`; wrap in a function-level exception handler that never leaves the table empty when the new write fails. Add a rollback test.

### 6.3 Diagnostic RPC exposure — **S/security**
- Audit which `SECURITY DEFINER` functions are callable by `anon`/`authenticated` beyond their intended scope; revoke execute from non-owners; keep only the minimal surface the app calls. Grep: `lib/actions/*`, `supabase/functions/*`.

### 6.4 `.env.local` service-role JWT — **S/security**
- Ensure the service-role key is **not** committed (`grep -rn "service_role\|SERVICE_ROLE" .`), rotate it, document the rotation in `docs/OPS.md`, and enforce via a CI secret-scan step.

### 6.5 PDF export gaps — **M**
- **Files:** `app/api/reports/[id]/export/pdf/route.ts`, PDF kit pipeline.
- **Gap:** tables missing from Markdown-rendered PDFs (those with tables render as plain text).
- **Fix:** add a table renderer to the PDF composition that mirrors the Markdown/HTML table output used in `renderMarkdown`; snapshot-test the generated PDF bytes for a suite report.

### 6.6 CI hardening — **S**
- `.github/workflows/ci.yml`: run lint + tsc + vitest on PRs (it exists — verify it does), add a `--fail-fast` flag and a secret scan step (gitleaks or `trivy`), and a build smoke test (`npm run build`).

---

## Phase 7 — Delivery checklist (client-facing handoff)

Use this as the Go/No-Go list for the consulting engagement. Each item links to its phase.

| # | Deliverable | Phase | Owner |
|---|-------------|-------|-------|
| 1 | Upload flow tells the client exactly which of the 9 services each file powers | P2 | dev |
| 2 | Client can request the missing data in 1 tap; operator sees the queue | P2 | dev |
| 3 | Map tab renders sales/customers/stocks by city/region | P3 | dev |
| 4 | Client dashboard: one page per org with all 9 services as tabs | P4 | dev |
| 5 | Budget variance works across budget + sales files | P4.4 | dev |
| 6 | In-app training for all 9 services in Arabic + English | P5 | dev+client |
| 7 | Backend hardened (idempotent import, safe snapshots, secrets rotated, PDF tables) | P6 | dev |
| 8 | Operator/superadmin can see every org’s completeness score and outstanding requests | P2 + P4 | dev |

**Go criteria before speaking to the client:** P2 (1–2), P3 (3), P4 (4–5), P5 (6) complete and demoed on a real client file (e.g. the Pharco/GSK/Tableau samples in `samples/`).

---

## Sequencing & risk matrix

| Risk | Mitigation |
|------|-----------|
| Tile service goes down (map) | SVG dot fallback (P3.1) |
| Cross-dataset joins are slow at scale | Keep projections + joins server-side in one pass (P4.3) |
| Arabic content quality | Draft copy with the client before P5 seed |
| Service-role key already leaked | Rotate + scan now (P6.4) before anything ships |
| Scope creep | Each phase has an explicit "done" gate; defer P4.5/P7 items that aren't required |

**Build order (recommended):** P2 → P3 → P4 → P5 → P6. P7 is the gate, not a build phase.