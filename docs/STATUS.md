# SiroQ Pharma BI — Live Status Ledger

Single source of truth for **what has been done, who is working on it now, and what is blocked**.
Every agent (human or AI, any device) follows the rules in `AGENTS.md §Coordination` and updates this file in the **same commit** that changes the code.

Columns:
- **Status:** `todo` · `active` · `done` · `blocked`
- **Commit:** short SHA once the work is committed
- **Verification:** the test/command that proves "done" (must be green)

---

## Global rules of the shared ledger

1. **One row per task** from `docs/PLAN-REMAINING.md`. Never delete a row; flip status.
2. **Update STATUS.md in the same commit** as the code it reports on. Commit message prefix: `P<phase>.<task>`.
3. **"done" only when the listed verification passes.** A task without a green verification is `active`, never `done`.
4. If you start a task, flip it to `active` with your handle/device in **Owner**, so no second agent picks it up.
5. Anything ambiguous → add to **Open questions / handoffs** below, not to private notes.
6. At session start, **every agent reads** `docs/PLAN-REMAINING.md` + this file before acting.

---

## Phase 0 — Foundation (roles, services catalog, upload templates)

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P0.1 | Extend `ColumnRole` + lexicon (EN/FR/DE/AR), `roleLabel`, `normalizeHeader` (preserve Arabic, strip harakat) | done | 2026-08-19 | — | ibrahim | `npx vitest run test/roles*` (26 passed) |
| P0.2 | Coordinate inference header-only (value-shape heuristic removed) | done | 2026-08-19 | — | ibrahim | `npx vitest run test/roles-services.test.ts` |
| P0.3 | Greedy-substring priority regexes (`counted_qty`, `purchase_cost`, `purchase_qty`) | done | 2026-08-19 | — | ibrahim | full suite green |
| P0.4 | `KEY_FALLBACKS` + roleMap for new roles; `resolveRoleKey` role-skip fix | done | 2026-08-19 | — | ibrahim | `test/analysis-services-lens.test.ts` |
| P0.5 | `lib/analysis/services.ts` (9 services, `assessServiceCoverage`) | done | 2026-08-19 | — | ibrahim | `test/roles-services.test.ts` |

## Phase 1 — First vertical slice: the five new lens modules

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P1.1 | `sales.ts`, `supplier.ts`, `geography.ts`, `budget.ts`, `stocktake.ts` modules | done | 2026-08-19 | — | ibrahim | `npx vitest run test/analysis-services-lens.test.ts` |
| P1.2 | `modules.ts`: ProjectedRows + `buildSuite` orchestration (12 modules) | done | 2026-08-19 | — | ibrahim | suite tests green |
| P1.3 | UI cards in `pharmacy-modules.tsx` (Sales/Supplier/Geography/Budget/Stocktake) | done | 2026-08-19 | — | ibrahim | `npx tsc --noEmit`, eslint 0 err |
| P1.4 | `test/analysis-services-lens.test.ts` (14 tests) | done | 2026-08-19 | — | ibrahim | full suite 159/159 |

## Phase 2 — Wire service-coverage into the upload flow ("ask the client for missing data")

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P2.1 | `components/service-coverage.tsx` (coverage grid + request builder) | todo | | | | `npx vitest run test/service-coverage-card.test.tsx` |
| P2.2 | Integrate coverage card into `upload-flow.tsx` between preview and confirm | todo | | | | manual demo + unit test |
| P2.3 | Persist `service_coverage` + `data_requests` jsonb on `datasets` (+ migration) | todo | | | | migration applied; `createDataset` stores | 
| P2.4 | Operator missing-data checklist in admin (`operator-requests`). | todo | | | | manual QA |

## Phase 3 — Geography map (Leaflet)

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P3.1 | Add `leaflet` + `react-leaflet` (React19-compatible) + tile-fail SVG fallback | todo | | | | build ok, SSR no-crash |
| P3.2 | `components/geo-map.tsx` + wire into `GeographyCard` | todo | | | | renders markers on browser build |
| P3.3 | Map data seams (no geocoder in this phase) | todo | | | | table fallback when no coords |

## Phase 4 — Org-level client dashboard

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P4.1 | `org/[id]` route + nav from datasets list; RLS gate | todo | | | | non-member → redirect/403 |
| P4.2 | `org-dashboard.tsx` overview (KPI strip + service grid) | todo | | | | manual demo |
| P4.3 | `service-tabs.tsx` + `service-lens-panel.tsx`; one-pass server action | todo | | | | all 9 tabs render |
| P4.4 | Cross-dataset budget actuals (`combineOrgBudgets`), budget tab uses it | todo | | | | variance across 2 files |
| P4.5 | Optional geocoding (deferred, non-blocking) | todo | | | | not required to close P4 |

## Phase 5 — In-app training content (تدريب)

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P5.1 | `training_lessons` + `training_progress` tables, idempotent seed (9 lessons ar+en) | todo | | | | migration + seed QA |
| P5.2 | `/training` list + lesson routes + Markdown renderer + progress toggle | todo | | | | manual QA ar+en |
| P5.3 | Coverage "needs data" chips link to training lesson | todo | | | | link works from any page |

## Phase 6 — Backend hardening (audit 2026-08-19)

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P6.1 | Idempotent `retryImport` (truncate-in-txn + batch key) | todo | | | | failure-injection test |
| P6.2 | `snapshot_report_kpis` upsert instead of delete+insert | todo | | | | rollback test |
| P6.3 | Restrict diagnostic RPCs (`SECURITY DEFINER` surface) | todo | | | | anon/authenticated can't overreach |
| P6.4 | Service-role JWT: verify not committed, document rotation in `docs/OPS.md` | **blocked** | 2026-08-19 | — | ibrahim | `grep -rn "SERVICE_ROLE" .` clean (needs key owner) |
| P6.5 | PDF export: table renderer mirroring `renderMarkdown` tables | todo | | | | byte snapshot test |
| P6.6 | CI: fail-fast + secret scan + build smoke test | todo | | | | CI green on PR |

## Ad-hoc requests (user-directed work outside P2–P8)

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| AH-1 | Signup collects pharmacy details (name, license no/expiry, phone, address, full name) and auto-creates org + org_profile via `create_owner`/`submit_org_profile`; first login completes pending setup from user metadata | done | 2026-08-21 | — | opencode (ox-alpha) | `npx vitest run test/auth-signup.test.ts` (10 passed); full suite 169/169; tsc+eslint clean |
| AH-2 | Settings page shows organization card: review status badge (pending/active/rejected/suspended), rejection reason, license-expiry warning, pharmacy profile summary, manage-org link; CTA when no org (`components/account-org-card.tsx`) | done | 2026-08-21 | — | opencode (ox-alpha) | full suite 169/169; tsc+eslint clean |
| AH-3 | UI pass 1: active-route highlighting in app shell (`components/app-nav.tsx`, longest-prefix match + aria-current); landing page now renders all missing Arabic descriptions (services/how-it-works/features/benefits); fixed corrupted Arabic string + stray space | done | 2026-08-21 | — | opencode (ox-alpha) | full suite 169/169; tsc+eslint clean |
| AH-4 | UI pass 2 (style+UX, all four directions): (a) token refresh — layered soft shadows (`--shadow-sm/md/lg`), `text-wrap: balance/pretty`, `.tabular-nums-all`; (b) route-level loading skeletons via shared `ListPageSkeleton` for datasets/reports/applications/dashboard/settings/org; (c) workspace polish — ARIA tabs w/ scroll, AG Grid quartz retuned to app tokens, table density toggle (localStorage via `useSyncExternalStore`); (d) bilingual infra — `lib/i18n.ts` EN/AR dict, `LanguageProvider`/`useLang`/`Trans`, `LanguageToggle` in both headers, nav/auth/settings chrome translated, `<html dir>` flips to rtl | done | 2026-08-21 | — | opencode (ox-alpha) | `npm run check`: lint 0 errors (112 pre-existing warnings), tsc clean, vitest 169/169 |

| AH-5 | Colors & display pass: theme-aware categorical chart palette (`--chart-1..6` light+dark, mapped to Tailwind `--color-chart-*`), report-block charts switched from hardcoded hexes to tokens; dark theme neutrals refined from muddy green cast to charcoal-teal; Leaflet markers read resolved brand color (SVG attrs can't use CSS vars); tabular-nums on KPI strips + dataset row counts | done | 2026-08-21 | — | opencode (ox-alpha) | full suite 169/169; tsc clean; eslint 0 errors |

## Meta — the plan + ledger themselves

| Task | Title | Status | Date | Commit | Owner | Verification |
|---|---|---|---|---|---|---|
| P0-M | `docs/PLAN-REMAINING.md` master plan written | done | 2026-08-19 | — | ibrahim | reviewed by user |
| P0-M | `docs/STATUS.md` shared ledger + `AGENTS.md §Coordination` pointer | done | 2026-08-19 | — | ibrahim | read by session start |

---

## Open questions / handoffs (add anything ambiguous here)

- **Supabase project link mismatch (RESOLVED 2026-08-22):** Linked CLI directly to canonical project `vhgkjxdwptirmyqjhiks`, repaired migration history state, and ran `supabase db push` to apply all 38 migrations successfully.

- **P6.4 blocked:** rotating the service-role key needs the owner of the secret /.env.local — assign an owner and document rotation in `docs/OPS.md` before unblocking.
- **P5 seed copy:** Arabic body copy (9 lessons) should be drafted/approved with the client before the migration is written.
- **P4.4 join keys:** confirm with client whether budget sheets are by `period × category`, `period × branch`, or both, before `combineOrgBudgets` keys are fixed.
- **P3 tile provider:** pick OSM vs alternative + usage limits for the production region; SVG fallback is required regardless.
- **Who is "you":** this ledger is read/written by whatever agent is in charge of that repo — including future opencode sessions whose Memory MCP references `docs/PLAN-REMAINING.md` + this file.