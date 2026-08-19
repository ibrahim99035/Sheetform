# DuckDB-WASM Hybrid — Local-First Pharmacy BI Platform

Status: **In build**. Plan of record for pivoting SiroQ from a server-centric
(supabaseStore) data plane to a local-first hybrid: the browser owns raw data
and computation (DuckDB-WASM), the cloud is a control plane (auth, aggregate
benchmarking, metadata, optional encrypted `.parquet` backups).

Companion docs: this plan expands `PLAN-app-centric.md` (still valid for the
report-blocks/add-column/app-centric work, now executed against the local data
plane). The plan is mirrored in the **memory knowledge graph** — future
sessions resume from `memory_open_nodes(["DuckDB-WASM hybrid migration plan"])`
and the per-phase entities.

---

## 1. Decisions (locked, from Q&A)

- **Foundation:** adopt the DuckDB-WASM hybrid. Raw rows stay in the browser
  (OPFS); cloud keeps auth, metadata, opt-in aggregates, mapping templates, and
  optional backups. Legacy PostgreSQL analysis RPCs are retained as a fallback
  engine behind `NEXT_PUBLIC_DATA_ENGINE=duckdb|supabase`.
- **Modules (all deterministic, NO AI):** Customer RFM + basket analysis,
  ABC-XYZ inventory + safety stock, expiry-risk tracking, deterministic
  forecasting (moving average + Holt-Winters), cross-pharmacy anonymized
  benchmarking.
- **Privacy:** benchmarking is opt-in; patient columns are dropped or SHA-256
  hashed before any cloud sync (`lib/privacy.ts`); RLS keeps tenants isolated.
- **Editing:** add AG Grid Community for Excel-like spreadsheet editing; edits
  are applied as a local operation queue (rename/filter/dedupe/edit/add/delete/
  bulk) with an undo/redo stack, preserving the audit model.
- **Multi-device sync (default):** encrypted `.parquet` via DuckDB
  `COPY ... TO (FORMAT PARQUET)` uploaded to a per-tenant private Storage bucket;
  WebRTC P2P deferred.
- **Forecasting:** SMA + Holt-Winters in client TS over the DuckDB time series;
  MAPE reported; no external time-series dependency.

## 2. Target architecture

```
User's browser (data plane)                     Cloud / Supabase (control plane)
┌────────────────────────────────────┐          ┌──────────────────────────────────┐
│ Web Worker: DuckDB-WASM           │ tiny      │ Auth (identity)                  │
│  · CSV/XLSX -> typed tables       │ aggregates │ pharmacies / tenant metadata    │
│  · all SQL analytics (KPIs,       │─────────▶ │ daily_aggregates /              │
│    group_by, ABC-XYZ, RFM,        │ KB/day    │   category_benchmarks           │
│    time_pattern, forecast)        │ optional  │ mapping_templates               │
│ AG Grid: full editing (op queue)  │ .parquet  │ Storage: per-tenant private     │
│ OPFS: persist tables + op stack   │ backups   │   bucket (RLS), opt-in backups  │
└────────────────────────────────────┘          └──────────────────────────────────┘
```

- Raw rows **never leave the browser** unless the owner opts in to encrypted
  parquet backups.
- `RPCs` group (Postgres `group_by`, `dataset_kpis`, `time_series`, ...) become
  DuckDB SQL in `lib/analysis/sql.ts` with **identical result shapes**; the
  client `lib/analysis/` engine already runs client-side and stays unchanged.

## 3. Browser & platform support (constraints the plan must satisfy)

DuckDB-WASM compatibility, verified against current `@duckdb/duckdb-wasm` docs:

- **COI is the performance ceiling.** The fast COI bundle (SIMD + threads) only
  activates under cross-origin isolation
  (`Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp`). `duckdb.ts` must gate on
  `await duckdb.getPlatformFeatures()`: only when `crossOriginIsolated` set
  `maximumThreads = navigator.hardwareConcurrency`; otherwise `selectBundle`
  falls back to EH/mvp (single-threaded).
- **Browser matrix:** Chrome/Edge 91+ = COI path. **Firefox and Safari → no COI**
  (single-threaded); old Safari also had broken OPFS/SafeStorage APIs. Behavior:
  capability detector in Phase 1 chooses local vs server import automatically.
- **Next.js assets:** `next build` must emit the `.wasm` and worker files. If
  `?url` imports don't survive the build, copy bundles under `public/duckdb/`
  and reference fixed paths. First instantiate downloads ~20–30MB (eh/mvp).
- **CSP:** DuckDB-WASM requires `wasm-unsafe-eval` in the Content-Security-Policy
  or it won't instantiate. Set via `next.config.ts` headers alongside COI.
- **Memory:** `registerFileHandle(..., BROWSER_FILESTREAM)` streams files in;
  chunked inserts cap transient WASM heap. Gate by file size + device capability.
- **OPFS durability:** OPFS is evicted under disk pressure and wiped by
  incognito / "clear site data". Backup/download (parquet) is **first-class UX**,
  not optional.
- **Single tab = single data plane:** two tabs = two DuckDB instances writing
  OPFS; guard with a lock flag to avoid corruption.
- **Testing:** `vitest` (Node) validates DuckDB SQL/math; browser-only behavior
  (OPFS, Worker, COI, bundle fallback) is covered by Playwright
  (`scripts/e2e-local.mjs`) across chromium (COI) + firefox + safari.

## 4. Phases

### Phase 0 — Foundations (`lib/`)
1. `lib/db/duckdb.ts` — singleton `AsyncDuckDB` on a Web Worker:
   - `getPlatformFeatures()` gate → `maximumThreads` when COI.
   - `selectBundle` (manual mvp/eh bundles) + fallback.
   - `registerFileHandle` (`BROWSER_FILESTREAM`), table registry.
   - `q(sql, params)` → rows as JSON (Arrow → `toArray().map(r => r.toJSON())`).
2. `lib/db/opfs.ts` — persist/restore tables + op stack in OPFS; `exportBackup()`
   Blob download.
3. `lib/datastore.ts` — backend abstraction over the operations the UI already
   calls: `fetchRows`, `fetchRowCount`, `fetchGroupBy`, `applyOperation`,
   `undoOperation`/`redoOperation`, `addColumn`, `runAnalysisQuery`; two
   implementations:
   - `duckdbStore` (default, `NEXT_PUBLIC_DATA_ENGINE=duckdb`)
   - `supabaseStore` (existing RPC path — regression baseline + fallback).
4. `lib/analysis/sql.ts` — DuckDB query builders (ported RPC SQL, same shapes).
5. `lib/types.ts` — `DatasetKind = 'sales' | 'inventory'`, `InventoryRow`
   (`expiry_date`, `stock_on_hand`), `BenchmarkOptIn`; no breaking changes to
   `ColumnDef`/`Dataset`.
6. `next.config.ts` — COI + `wasm-unsafe-eval` CSP headers (see §3).

### Phase 1 — In-browser ingestion & column mapping
- Browser parsing (papaparse CSV + SheetJS XLSX multi-sheet), reuse
  `lib/coerce`/`lib/parse` inference; `components/mapping-dialog.tsx` reusing
  `inferRoles` lexicon; template persists to cloud `mapping_templates`.
- Quarantine tab (AG Grid) for coercion failures, editable before commit.
- Capability detector (COI + OPFS availability) routes local `duckdbStore` vs
  server `import-dataset` Edge fn (huge files / no-WASM / Safari).

### Phase 2 — Local analysis engine (parity)
- Port `group_by`, `dataset_kpis`, `time_series`, `rank_samples`, `refund_rate`,
  `concentration`, `branch_ranking`, `time_pattern`, `quality_profile` to
  DuckDB SQL, honoring `view.filters` (port `_sf_filter_condition` semantics).
- `computeMetrics`/`generateInsights`/`renderMarkdown` unchanged.
- Parity tests `test/duckdb.test.ts`: same outputs as RPC path under
  `npm run check`.

### Phase 3 — Spreadsheet editing
- Add `ag-grid-community` + React wrapper; render grid over local table in
  `data-table.tsx` / `dataset-workspace.tsx`.
- Local op queue (rename/filter/dedupe/edit/add/delete/bulk) with undo/redo
  persisted to OPFS; `add_column` natively in DuckDB (formula + blank typed
  columns); stats recompute; charts re-render on commit.

### Phase 4 — Five analytics modules (each ~300–600 LOC, deterministic)
- **ABC-XYZ** `lib/analysis/abc-xyz.ts`: ABC via cumulative revenue share
  (`SUM(revenue) OVER (ORDER BY revenue DESC)`: A≤80% / B≤95% / C); XYZ via
  `CV = stddev(daily)/mean`: X<0.1 / Y<0.25 / Z; AX…CZ matrix.
- **Safety stock** `lib/analysis/reorder.ts`:
  `ReorderPoint = d·L + z·σ_d·√L`, `SafetyStock = z·σ_d·√L`; user lead-time,
  service-level z-table (1.65 @ 95%).
- **Expiry risk** `lib/analysis/expiry.ts`: inventory dataset +
  `days_to_cover = stock/avg_daily_demand`, flag expiring-before-covered,
  `financial_exposure = stock_on_hand × unit_cost`.
- **RFM + basket** `lib/analysis/rfm.ts` & `basket.ts`: R/F/M →
  `NTILE(5)` → Champions/Loyal/At Risk/Lost/Hibernating; anonymous walk-in
  fallback (branch + time bucket); co-purchase pairs by `transaction_id`.
- **Forecasting** `lib/analysis/forecast.ts`: SMA + Holt-Winters; MAPE + N-day
  horizon; Recharts `ForecastView` block (`body.series` + `forecast` segment).

### Phase 5 — Benchmarking (opt-in, hashed)
- Local daily/category rollups upsert ONLY aggregates (`daily_aggregates`,
  `category_benchmarks`; KB/day/tenant). `lib/privacy.ts` hashPatient (SHA-256),
  patient columns excluded from payloads. RLS; `get_benchmarks(region,category)`
  SECURITY DEFINER returns market averages excluding caller tenant;
  `benchmark_opt_in` default false; region from org/branch metadata.

### Phase 6 — Workspace, reports & sync
- `application-workspace` `handleAddBlock` snapshots local result JSON →
  `report_blocks` → `report_components`; publish/composer/viewer/deliver flow
  unchanged. Multi-device parquet sync; mapping-template sync. Backup/restore
  UX first-class (§3 OPFS durability).

### Phase 7 — Verification & docs
- `npm run check`; new tests (`duckdb`, `rfm`, `forecast`, `abc-xyz`);
  `scripts/e2e-local.mjs` Playwright across chromium/firefox/safari asserting
  ingest → edit → RFM → ABC-XYZ → forecast → publish on sales+inventory fixtures
  and the header/bundle regime (§3).
- Update `docs/SPECS.md` + `docs/OPS.md` for the local-first data plane and
  retention (retention RPCs remain for cloud-resident data).

## 5. Dependencies

- **Add:** `@duckdb/duckdb-wasm`, `ag-grid-community`, `ag-grid-react`.
- **Keep:** `xlsx` (SheetJS 0.20.3), `papaparse`, `recharts`, tiptap.
- **Config:** `NEXT_PUBLIC_DATA_ENGINE=duckdb|supabase` feature flag.

## 6. Build order

P0 foundation seam → P1 ingestion → P2 parity → P3 grid+ops → P4 five modules →
P5 benchmarking → P6 reports/sync → P7 verify+docs.

## 7. Verification contract

- `npm run check` green at every phase end.
- Every DuckDB query has a parity/unit test; browser-only paths via Playwright.
- Supabase path (`supabaseStore`) stays runnable as fallback + regression baseline.