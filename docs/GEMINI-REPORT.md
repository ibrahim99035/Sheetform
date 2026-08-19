# SiroQ — Progress Report for Gemini

Handoff report covering (a) everything built before this session and (b) the
work completed most recently. Written so a fresh Gemini session can resume the
DuckDB-WASM hybrid plan from a precise, verified state.

Repo: `/media/ibrahim/New Volume/Projects/sheetform` · Next.js 16.3 App Router +
Supabase (Postgres / Auth / Storage / Edge Functions) + TypeScript.

---

## 1. Where we are

The **DuckDB-WASM hybrid** plan (local-first data plane + cloud control plane)
is mid-build. The foundation (Phase 0) shipped earlier; this session shipped
**Phase 4 — the five deterministic analytics modules** as pure TypeScript, plus
a server action and UI wiring, all tests green, all verified in a real browser.

Current gate status: `tsc` clean · ESLint **0 errors** (107 pre-existing
warnings) · **117/117 vitest tests pass** · browser smoke-test passed with
**0 console errors**.

---

## 2. What was done BEFORE this session

### 2.1 Product foundation (server-centric era)
- CSV/XLSX import through a Supabase Edge function into `dataset_rows` (jsonb);
  column inference (`lib/parse`), type coercion (`lib/coerce`), role inference
  (`lib/analysis/roles.ts` with `inferRoles` lexicon).
- Full deterministic analysis engine in client TS: `runAnalysis`, metrics,
  quality profile, insights, markdown rendering (`lib/analysis/{metrics,quality,
  insights,markdown,index}.ts`).
- PL/pgSQL analytics RPCs on Postgres (`group_by`, `dataset_kpis`,
  `time_series`, `time_pattern`, `concentration`, `quality_profile`,
  `rank_samples`, `refund_rate`) — the current cloud fallback engine.
- Editing ops with undo/redo (rename/filter/dedupe/edit/delete), charts
  (recharts), privacy/compliance retention + patient role, branch RBAC.
- Reports → `report_blocks` → `report_components` publish/deliver flow, rich
  text, component visibility, PDF export (pdfkit), applications workflow.
- UI: design system + dark mode, mobile responsiveness, superadmin admin panel.

### 2.2 Phase 0 — Local engine foundation (previously shipped & verified)
- `lib/db/duckdb.ts` — AsyncDuckDB singleton on a Web Worker; `selectBundle`
  chooses mvp/eh vs COI bundle by `crossOriginIsolated`; `getPlatformFeatures()`
  gate sets `maximumThreads = hardwareConcurrency` only under COI.
- COI headers (`COOP: same-origin` + `COEP: require-corp`) confirmed live on `/`;
  real DuckDB COI bundle instantiated and executed a CREATE/INSERT/SELECT round
  trip in-browser (Arrow `.toJSON()` path) with 0 console errors.
- `lib/db/opfs.ts` (OPFS persistence/backup), `lib/datastore.ts` backend
  abstraction (`duckdbStore` default vs `supabaseStore` fallback behind
  `NEXT_PUBLIC_DATA_ENGINE`), CSP `wasm-unsafe-eval`.
- `lib/types.ts` gained `DatasetKind = 'sales' | 'inventory'`, `InventoryRow`
  (`expiry_date`, `stock_on_hand`), `BenchmarkOptIn`.
- `lib/privacy.ts` — SHA-256 (Web Crypto) / FNV-1a fallback hashing for the
  opt-in benchmark uplink.

Full decisions/architecture live in `PLAN-duckdb-hybrid.md` and the memory
knowledge graph (`DuckDB-WASM hybrid migration plan` + per-phase entities).

---

## 3. What was done NOW (this session)

### 3.1 Phase 4 — Five analytics modules (pure TS, deterministic, NO AI)
New files under `lib/analysis/` (~2,400 LOC):

| File | Module | Output |
|---|---|---|
| `shared.ts` | Common math/format helpers | percentiles, rounding, safety |
| `rfm.ts` | Customer RFM (`runRfm`) | per-customer `recency_days/r/f/m`, quintile scores, segment taxonomy (`segmentFor(r,f)`) |
| `basket.ts` | Market basket (`runBasket`) | co-purchase pairs `product_a/product_b/pairs/support/confidence_a/lift`, `minPairs` default 2 |
| `abc-xyz.ts` | ABC-XYZ (`runAbcXyz`, `demandSeriesByProduct`) | item `revenue_share/abc/xyz`, 9-cell `matrix` (AX…CZ), thresholds |
| `safety-stock.ts` | Safety stock (`runSafetyStock`) | per-item `avg_daily_demand/demand_stddev/safety_stock/reorder_point/insufficient_history`, params `serviceLevel/leadTimeDays` |
| `expiry.ts` | Expiry risk (`runExpiry`) | `buckets/items/at_risk_units/at_risk_exposure/total_stock_value`; missing expiry → 180d+ bucket |
| `forecast.ts` | Forecast (`runForecast`) | `history/forecast/fitted` (`value` fields) + `method`; SMA + Holt-Winters (level/trend/season), MAPE |
| `benchmark.ts` | Benchmark rollups (`dailyRollups`, `categoryRollups`) | branch-day + category aggregates, `patient_count`, `hashed_patients` |
| `modules.ts` | **Orchestrator `buildSuite`** | `projectRows` → typed inputs → `PharmacySuite` with 7 `ModuleState<T>` branches (`available`/`reason`); role resolution (`resolveRoleKey`, `resolveInventoryColumn`, `KEY_FALLBACKS`), `SuiteRunOptions` |
| `sql.ts` | DuckDB SQL builders (identical projections) | `abcRevenueSql`, `dailyDemandSql`, `rfmAggregateSql`, `basketPairsSql`, `forecastSeriesSql`, `benchmarkDailySql`, `categoryBenchmarkSql`, `expiryInventorySql`, `ident()` escaping |

Design decisions:
- `modules.ts` (TS orchestrator) is the **source of truth**; `sql.ts` supplies
  DuckDB SQL builders with identical projections so the same engine can later
  run against the local DuckDB table. Imported at top of `modules.ts` (no
  `require()`).
- Column roles resolve: explicit role map → `column_defs[].role` stamp → key
  fallbacks (`date`, `product`, `qty`, `unit_price`, `patient`, …) → null
  (module reports `Unavailable` with a human reason, never throws).
- Sales vs inventory projection: same `buildSuite` handles both `kind` modes.

### 3.2 Server action
`lib/actions/pharmacy.ts` — `runPharmacyAnalysis(datasetId, opts?: { kind?,
forecastMetric? ('units'|'revenue'), forecastHorizon?, benchmarkRegion? })`:
- `requireUser` → fetch dataset (`id/name/status/column_defs`) → require
  `status === 'ready'` → page through `get_dataset_rows` RPC (10k/page,
  `fetchAllRows`) → `buildSuite(columnDefs, rows, opts)`.
- Returns `{ ok: true; suite } | { ok: false; error }`.

### 3.3 UI wiring
`components/pharmacy-modules.tsx` — `PharmacyModules` (client, `useTransition`,
run/re-run button, skeletons, error banner) + 7 typed cards
(`RfmCard/BasketCard/AbcCard/SafetyCard/ExpiryCard/ForecastCard/BenchmarkCard`)
+ `Unavailable` fallback. Wired into `components/analyze-tab.tsx` after the
stats card, before Group-by.

### 3.4 Tests (all green, 117 total)
- `test/fixtures/pharmacy.ts` — sales (14 rows, 10 txns, revenue 200, units 19)
  + inventory fixtures, column defs, `PRODUCTS`, `avgDailyDemand`.
- `test/analysis-{suite,modules,forecast,benchmark,sql}.test.ts` — fixtures
  totals, module fields, DuckDB SQL builders, forecast math.

### 3.5 Bug found & fixed during browser verification
`runPharmacyAnalysis` originally selected a `kind` column on `datasets` —
**that column doesn't exist**, so PostgREST errored and the action masked it as
"Dataset not found". Fix: drop `kind` from the select (kind comes only from
`opts`), and surface the real DB error via `datasetErr.message`
(`lib/actions/pharmacy.ts:62-68`).

### 3.6 Browser verification (Playwright MCP, localhost:3000)
On `sales.csv` (4 rows) → Analyze tab → "Run analysis":
- All 7 cards render: RFM (3 scored customers), Market basket (3 txns / 4
  products, avg ticket 14), ABC-XYZ matrix (Ibuprofen listed), Safety stock
  (95% service level, 7-day lead), Demand forecast, Benchmark snapshot (3
  branch-day rows), and Expiry shows the correct *"needs an inventory dataset
  (expiry_date / stock_on_hand columns)"* unavailable message.
- **0 console errors.**

---

## 4. Known gaps / next steps (Phase 5–7 per plan)

1. **Phase 5 — Benchmarking uplink:** wire the local `benchmark.ts` rollups to
   upsert only aggregates into `daily_aggregates` / `category_benchmarks`
   (KB/day), `lib/privacy.ts` hashing enforced, `get_benchmarks(region,
   category)` SECURITY DEFINER returning market averages excluding the caller,
   `benchmark_opt_in` default false.
2. **Phase 6 — Reports & sync:** snapshot module results → `report_blocks` →
   `report_components`; encrypted `.parquet` multi-device sync; backup/restore
   UX first-class (OPFS eviction durability).
3. **Phase 7 — Verification & docs:** `scripts/e2e-local.mjs` Playwright across
   chromium (COI) + firefox + safari; update `docs/SPECS.md` + `docs/OPS.md`;
   DuckDB-WASM engine parity (`npm run check`).
4. **Not yet started:** AG Grid editing (Phase 3), local ingestion + DuckDB
   store parity (Phases 1–2).

Suggested resume entry point: `memory_open_nodes(["DuckDB-WASM hybrid
migration plan", "Phase 4: five analytics modules"])` then `PLAN-duckdb-hybrid.md`.
