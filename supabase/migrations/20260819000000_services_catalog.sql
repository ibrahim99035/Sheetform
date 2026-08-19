-- ============================================================
-- SiroQ Phase 0 — consulting services catalogs
--   * purchase / budget / stocktake analysis templates
--   * product template extended with geo + stock-count columns
--
-- Each service line requested by the client maps to a template the
-- pharmacy can submit files against:
--   - supplier analysis  -> purchase template
--   - financial budgets  -> budget template
--   - physical stock count / الجرد -> stocktake template
--   - geographic analysis -> city/country/region/coordinates roles on
--     sales/purchase files (columns are optional)
--
-- Columns carry role names that mirror lib/analysis/roles.ts (ColumnRole).
-- The DB stores role as free text; the role resolver (_sf_dataset_key_map)
-- reads column_defs.role + the template map, so new roles flow through
-- existing KPI RPCs without changes.
-- ============================================================

insert into public.templates (code, name, description, type, sensitivity)
values
  ('purchase',   'Purchases / supplier', 'Purchase orders and supplier invoices: supplier, PO number, product, qty, cost.', 'product', 'sales_financial'),
  ('budget',     'Financial budget',    'Period targets by category and branch: budget amount vs actual sales.', 'financial', 'sales_financial'),
  ('stocktake',  'Physical stock count', 'Count sheets: product, batch, counted qty vs system stock (الجرد الفعلي).', 'product', 'sales_financial')
on conflict (code) do nothing;

insert into public.template_columns (template_code, key, label, type, required, role) values
  -- Purchases / supplier analysis
  ('purchase', 'purchase_date',  'Purchase date',        'date',    true,  'purchase_date'),
  ('purchase', 'supplier',       'Supplier',             'string',  true,  'supplier'),
  ('purchase', 'purchase_order', 'Purchase order no.',   'string',  false, 'purchase_order'),
  ('purchase', 'branch',         'Branch',               'string',  false, 'branch'),
  ('purchase', 'product',        'Product',              'string',  true,  'product'),
  ('purchase', 'category',       'Category',             'string',  false, 'category'),
  ('purchase', 'purchase_qty',   'Quantity purchased',   'numeric', true,  'purchase_qty'),
  ('purchase', 'purchase_cost',  'Unit purchase cost',   'numeric', false, 'purchase_cost'),
  -- Financial budgets
  ('budget', 'date',        'Period',         'date',    true,  'date'),
  ('budget', 'branch',      'Branch',         'string',  false, 'branch'),
  ('budget', 'category',    'Category',       'string',  false, 'category'),
  ('budget', 'budget',      'Budget amount',  'numeric', true,  'budget'),
  -- Physical stock count / الجرد
  ('stocktake', 'date',        'Count date',      'date',    true,  'date'),
  ('stocktake', 'branch',      'Branch',          'string',  false, 'branch'),
  ('stocktake', 'product',     'Product',         'string',  true,  'product'),
  ('stocktake', 'batch',       'Batch / lot',     'string',  false, 'batch'),
  ('stocktake', 'qty',         'System stock',    'numeric', false, 'qty'),
  ('stocktake', 'counted_qty', 'Counted quantity','numeric', true,  'counted_qty'),
  ('stocktake', 'unit_price',  'Unit price',      'numeric', false, 'unit_price'),
  ('stocktake', 'cost',        'Unit cost',       'numeric', false, 'cost')
on conflict (template_code, key) do nothing;

-- Extend the sales template with optional geographic + sales-force roles
-- (needed for geographic analysis and chain/upstream attribution).
insert into public.template_columns (template_code, key, label, type, required, role) values
  ('sales', 'supplier',     'Supplier',      'string', false, 'supplier'),
  ('sales', 'city',         'City',          'string', false, 'city'),
  ('sales', 'country',      'Country',       'string', false, 'country'),
  ('sales', 'region',       'Region',        'string', false, 'region'),
  ('sales', 'latitude',     'Latitude',      'numeric', false, 'latitude'),
  ('sales', 'longitude',    'Longitude',     'numeric', false, 'longitude'),
  ('sales', 'sales_rep',    'Sales rep',     'string',  false, 'sales_rep'),
  ('sales', 'sales_team',   'Sales team',    'string',  false, 'sales_team')
on conflict (template_code, key) do nothing;