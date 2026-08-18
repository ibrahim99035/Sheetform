# SiroQ — Capability brief

> Grounds the conversation in working software. "Built" = demoable today.
> "Pending" = scoped, planned, not yet in the build. "Open terms" = design/
> commercial details to be agreed. Default position: **scope and timeline can be
> adjusted; feasibility is not in question.**

## 1. Built (demoable now)

| Capability | Where | Notes |
| --- | --- | --- |
| Application workspace | `/applications/[id]`, `components/application-workspace.tsx` | Files list, per-file ready/processing states, `?dataset=` deep-link |
| Dataset workspace | `components/dataset-workspace.tsx`; tabs Data / Analyze / Engine / Activity | Rows, stats, group-by, deterministic engine, op history |
| Import pipeline | `add_application_file` + `import-dataset` edge fn | parse → coerce → chunked insert → `dataset_column_stats`; pending → ready |
| Dataset operations | `apply_dataset_operation` RPC | edit cell, add column, filter rows, dedupe; `inverse_payload` undo |
| Analysis engine | `lib/actions/analysis.ts` + `lib/analysis/` | 12 guarded RPCs, deterministic report + markdown, `dataset_analyses` snapshot |
| Report building blocks | `report_blocks` + add/reorder/delete RPCs | kinds chart/table/insight/text; `chart_type`; `branch_ids` scoping |
| WYSIWYG builder | `components/report-builder.tsx` | blocks render inline; **Preview report** shows the published page before it exists |
| Publish | `publishReport` → `report_components` | block → component mapping, visibility org/branch, links application |
| Report viewer | `/reports/[id]`, `components/reports/report-viewer.tsx` | recharts bar/line/area/pie, tables, markdown, rich text; PDF export |
| Delivery pipeline | `queue_report_deliveries` + `deliver-reports` edge fn | per-branch email/whatsapp flags, status machine, ≤3 attempts, retry |
| Governance | organizations → branches → users; RLS; `is_superadmin()` | scoped visibility; report blocks superadmin-only (single operator model) |

## 2. Pending (scoped, planned, not built yet)

| # | Item | Notes / effort |
| --- | --- | --- |
| 1 | **Admin dashboard + nav** — sidebar admin (Applications + Users) on `/admin`, non-admin (Home/About/Contact/Profile) nav, authed `/` redirect split | Phase 3; mostly UI restructuring + reuse of the existing `admin-users` surface |
| 2 | **Inline upload** button on the application File list | Thin wrapper over existing `add_application_file` |
| 3 | **Column role assignment** so deterministic KPIs resolve in the engine | Needs role inference/assign + a small coerce-time write; unflagged, affects metric confidence only |
| 4 | Delivery contract specifics | schedules, per-recipient overrides, unsubscribe/template branding |

## 3. Open terms

- Delivery channel mix (email / WhatsApp / both) and volume tiers.
- Block-scope semantics: org-wide vs branch-grouped for a multi-pharmacy pilot.
- Who gets admin vs read/operator access (single superadmin today).
- Template/branding of exported PDFs and emails.
- Support/SLA for the monthly ingestion cycle (file formats, error-handling UX).

## 4. Bumping-up logic (why these four pending items close the loop)

- **1** turns "operator console" into a true multi-role SaaS surface (admin +
  pharmacist read views) — the difference between a demo and a product.
- **2 + 3** make a single weekly workflow fully self-serve: upload in place →
  role-aware KPIs → publish.
- **4** is the recurring-revenue engine (scheduled delivery).