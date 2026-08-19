-- ============================================================
-- P5.1 — In-app training content (تدريب)
--
-- Tables:
--   * `training_lessons` — one row per lesson (slug, title, body, service)
--   * `training_progress` — per-user completion tracking
--
-- Seed: 9 lessons (one per service), Arabic + English titles.
-- RLS: any authenticated user can read lessons; progress is per-user.
-- ============================================================

create table if not exists public.training_lessons (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title_ar    text not null,
  title_en    text not null,
  service_id  text not null,
  body_md     text not null,
  order_index int not null default 0,
  visibility  text not null default 'all' check (visibility in ('all','operator')),
  created_at  timestamptz not null default now()
);

create table if not exists public.training_progress (
  user_id     uuid not null references auth.users(id) on delete cascade,
  lesson_slug text not null references public.training_lessons(slug) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_slug)
);

alter table public.training_lessons enable row level security;
alter table public.training_progress enable row level security;

-- Anyone authenticated can read lessons
create policy "Authenticated read lessons"
  on public.training_lessons for select
  to authenticated
  using (true);

-- Users read/write their own progress
create policy "User read own progress"
  on public.training_progress for select
  to authenticated
  using (auth.uid() = user_id);

create policy "User insert own progress"
  on public.training_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "User delete own progress"
  on public.training_progress for delete
  to authenticated
  using (auth.uid() = user_id);

-- Seed lessons (idempotent)
insert into public.training_lessons (slug, title_ar, title_en, service_id, body_md, order_index) values
  (
    'sales-analysis',
    'تحليل البيع',
    'Sales Analysis',
    'sales',
    E'## What is Sales Analysis?\n\nSales analysis tracks revenue, units sold, product mix, and period-over-period performance.\n\n## What data do I need?\n\nAt minimum: **date**, **product**, and **quantity** columns. For deeper insights, add **revenue**, **unit_price**, **category**, and **branch**.\n\n## How to read the output\n\n- **Revenue trend** — total revenue over time\n- **Top products** — best sellers by units and revenue\n- **Category mix** — share of each product category\n\n## Common mistakes\n\n- Missing dates → time-based analysis won\'t work\n- Mixing currencies → ensure all amounts are in the same currency\n- Duplicate rows → use dedup before analysis',
    1
  ),
  (
    'inventory-analysis',
    'تحليل المخزون',
    'Inventory Analysis',
    'inventory',
    E'## What is Inventory Analysis?\n\nCovers ABC/XYZ classification, safety stock, expiry risk, and reorder recommendations.\n\n## What data do I need?\n\nAt minimum: **product** and **quantity**. For full coverage: **expiry_date**, **stock_on_hand**, **cost**, **sku**, **batch**.\n\n## How to read the output\n\n- **ABC class** — A (top 80% revenue), B (next 15%), C (last 5%)\n- **XYZ class** — X (stable demand), Y (variable), Z (erratic)\n- **Safety stock** — minimum stock to avoid stockouts\n\n## Common mistakes\n\n- No expiry dates → expiry risk analysis falls back to 180-day assumption\n- Stock snapshots without dates → ABC-XYZ needs historical data',
    2
  ),
  (
    'customer-analysis',
    'تحليل العملاء',
    'Customer Analysis',
    'customers',
    E'## What is Customer Analysis?\n\nRFM segmentation (Recency, Frequency, Monetary) groups customers by behaviour.\n\n## What data do I need?\n\nAt minimum: **transaction_id** (or invoice number). Better with: **patient/customer ID**, **date**, **revenue**, **qty**.\n\n## How to read the output\n\n- **Segments** — Champions, Loyal, At Risk, Lost, Hibernating\n- **RFM scores** — 1-5 scale for each dimension\n- **Revenue concentration** — top customer share\n\n## Common mistakes\n\n- No transaction ID → individual purchases can\'t be grouped\n- Walk-in customers → use branch + time bucket as fallback',
    3
  ),
  (
    'supplier-analysis',
    'تحليل الموردين',
    'Supplier Analysis',
    'suppliers',
    E'## What is Supplier Analysis?\n\nTracks spend by supplier, purchase history, price trends, and concentration risk.\n\n## What data do I need?\n\nAt minimum: **supplier** name. Better with: **purchase_date**, **purchase_qty**, **purchase_cost**, **purchase_order**, **product**.\n\n## How to read the output\n\n- **Top suppliers** — by total spend\n- **Price trends** — cost changes over time\n- **Concentration risk** — dependency on single supplier\n\n## Common mistakes\n\n- Mixing purchase and sales data → keep purchases in a separate sheet\n- Missing supplier names → supplier analysis requires a supplier column',
    4
  ),
  (
    'geography-analysis',
    'تحليل جغرافي',
    'Geographic Analysis',
    'geography',
    E'## What is Geographic Analysis?\n\nShows sales, customers, and stock distribution by city, region, or country on a map.\n\n## What data do I need?\n\nAt minimum: one of **city**, **country**, or **region**. For map plotting: **latitude** and **longitude**.\n\n## How to read the output\n\n- **City/region rankings** — top locations by revenue\n- **Map markers** — visual distribution when coordinates are provided\n- **Customer density** — unique customers per location\n\n## Common mistakes\n\n- No coordinates → table view only (no map)\n- Inconsistent city names → standardize before import',
    5
  ),
  (
    'benchmarking',
    'المقارنات المرجعية',
    'Benchmarks',
    'benchmarks',
    E'## What is Benchmarking?\n\nCompares your pharmacy performance against anonymized market averages from opted-in pharmacies.\n\n## What data do I need?\n\nAt minimum: **date**. Better with: **branch**, **revenue**, **qty**, **category**. You must also **opt in** on the Benchmark tab.\n\n## How to read the output\n\n- **Daily revenue vs market** — your performance vs average\n- **Transaction count comparison** — foot traffic benchmark\n- **Margin analysis** — pricing competitiveness\n\n## Common mistakes\n\n- Not opted in → benchmarking requires explicit opt-in\n- Too few days → need at least 7 days for meaningful comparison',
    6
  ),
  (
    'forecasting',
    'التنبؤ بالمبيعات',
    'Forecasting',
    'forecasting',
    E'## What is Forecasting?\n\nPredicts future demand using moving average and Holt-Winters methods.\n\n## What data do I need?\n\nAt minimum: **date**. Better with: **qty** (for unit forecast) or **revenue** (for revenue forecast), **product**.\n\n## How to read the output\n\n- **Forecast line** — predicted values for the next N days\n- **Confidence band** — range of likely outcomes\n- **MAPE** — prediction accuracy (lower is better)\n\n## Common mistakes\n\n- Too little data → need at least 14 days for reliable forecast\n- Gaps in dates → the model interpolates but accuracy drops',
    7
  ),
  (
    'budgets',
    'الموازنات المالية',
    'Financial Budgets',
    'budgets',
    E'## What is Budget Analysis?\n\nCompares budgeted targets against actual performance by category and period.\n\n## What data do I need?\n\nA **budget sheet** with period, category, and target amount. For variance analysis, also import a **sales sheet** with actuals.\n\n## How to read the output\n\n- **Attainment %** — how much of the budget was achieved\n- **Variance** — over/under budget in absolute terms\n- **Burn rate** — pace of spending vs plan\n\n## Common mistakes\n\n- Budget and sales in same sheet → separate them into different files\n- Mismatched categories → ensure budget and sales categories align\n- Different time periods → budget periods should match sales periods',
    8
  ),
  (
    'stocktake',
    'الجرد الفعلي',
    'Physical Stock Count',
    'stocktake',
    E'## What is Stock Count Audit?\n\nCompares physical count sheets against system stock to find variances.\n\n## What data do I need?\n\nAt minimum: **product** and **counted_qty**. Better with: **batch**, **unit_price**, **cost**, **date**. System stock comes from the inventory dataset.\n\n## How to read the output\n\n- **Variance lines** — products where count differs from system\n- **Total variance** — units and value of discrepancies\n- **Audit trail** — which products need investigation\n\n## Common mistakes\n\n- No inventory dataset → system stock comparison requires inventory data\n- Counted qty as string → ensure it\'s a number',
    9
  )
on conflict (slug) do update set
  title_ar = excluded.title_ar,
  title_en = excluded.title_en,
  body_md = excluded.body_md,
  order_index = excluded.order_index;
