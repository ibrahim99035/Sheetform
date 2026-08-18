import type { AnalysisRpcPayload } from "@/lib/analysis/types";

// A realistic "sales" dataset fixture mirroring scripts/e2e-analysis.mjs:
// 4 rows, 3 transactions, revenue 42, units 8, cogs 12.5, margin 29.5.
export function salesPayload(): AnalysisRpcPayload {
  return {
    roles: {
      date: "date",
      transaction_id: "transaction_id",
      product: "product",
      category: "category",
      qty: "qty",
      unit_price: "unit_price",
      cost: "cost",
      refund: "refund",
    },
    quality: {
      rows: 4,
      columns: [
        { key: "date", label: "Date", type: "date", role: "date", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 75, negative_count: 0, outlier: false, currency_symbols: null, min: null, max: null, avg: null },
        { key: "transaction_id", label: "Transaction ID", type: "string", role: "transaction_id", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 75, negative_count: 0, outlier: false, currency_symbols: null, min: null, max: null, avg: null },
        { key: "product", label: "Product", type: "string", role: "product", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 100, negative_count: 0, outlier: false, currency_symbols: null, min: null, max: null, avg: null },
        { key: "category", label: "Category", type: "string", role: "category", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 50, negative_count: 0, outlier: false, currency_symbols: null, min: null, max: null, avg: null },
        { key: "qty", label: "Quantity", type: "numeric", role: "qty", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 75, negative_count: 0, outlier: false, currency_symbols: null, min: 1, max: 4, avg: 2 },
        { key: "unit_price", label: "Unit price", type: "numeric", role: "unit_price", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 75, negative_count: 0, outlier: false, currency_symbols: null, min: 2.5, max: 10, avg: 5.25 },
        { key: "cost", label: "Unit cost", type: "numeric", role: "cost", role_confidence: "high", missing_pct: 0, invalid_pct: 0, distinct_pct: 75, negative_count: 0, outlier: false, currency_symbols: null, min: 1, max: 4, avg: 1.5625 },
        { key: "refund", label: "Refund", type: "numeric", role: "refund", role_confidence: "medium", missing_pct: 50, invalid_pct: 0, distinct_pct: 25, negative_count: 0, outlier: false, currency_symbols: null, min: null, max: null, avg: null },
      ],
      flags: [],
    },
    kpis: {
      rows: 4,
      distinct_products: 4,
      revenue: 42,
      units: 8,
      cogs: 12.5,
      expenses: null,
      gross_margin: 29.5,
      gross_margin_pct: 70.24,
      avg_transaction: 14,
      min_date: "2026-01-05",
      max_date: "2026-02-02",
    },
    timeSeries: [
      { bucket: "2026-01", value: 30 },
      { bucket: "2026-02", value: 12 },
    ],
    comparison: {
      label: "2026-02",
      current_value: 12,
      prior_value: 30,
      delta: -18,
      delta_pct: -60,
    },
    refund: { gross_revenue: 42, refunds: 0, refund_rows: 0, refund_rate_pct: 0, estimated: true },
    concentration: {
      available: true,
      total_revenue: 42,
      distinct_products: 4,
      top5: [
        { label: "Amoxicillin 500", value: 20 },
        { label: "Paracetamol 1g", value: 12 },
        { label: "Vit C", value: 8 },
        { label: "Saline", value: 2 },
      ],
      top: [
        { label: "Amoxicillin 500", value: 20 },
        { label: "Paracetamol 1g", value: 12 },
        { label: "Vit C", value: 8 },
        { label: "Saline", value: 2 },
      ],
      top5_share_pct: 47.62,
      top_n_share_pct: 100,
    },
    topProducts: [
      { label: "Amoxicillin 500", value: 20, units: 4, grp_count: 2 },
      { label: "Paracetamol 1g", value: 12, units: 1, grp_count: 1 },
    ],
    bottomProducts: [{ label: "Saline", value: 2, units: 1, grp_count: 1 }],
    topCategories: [{ label: "Antibiotics", value: 32, units: 5, grp_count: 2 }],
    weekdayPattern: [
      { label: "Mon", value: 12, units: 3, grp_count: 1 },
      { label: "Tue", value: 30, units: 5, grp_count: 1 },
    ],
    hourPattern: [{ label: "10h", value: 42, units: 8, grp_count: 2 }],
    rows: 4,
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "transaction_id", label: "Transaction ID", type: "string" },
      { key: "product", label: "Product", type: "string" },
      { key: "category", label: "Category", type: "string" },
      { key: "qty", label: "Quantity", type: "numeric" },
      { key: "unit_price", label: "Unit price", type: "numeric" },
      { key: "cost", label: "Unit cost", type: "numeric" },
      { key: "refund", label: "Refund", type: "numeric" },
    ],
    sensitivity: "sales_financial",
    mode: "auto",
  };
}

// Dirtier dataset: missing date, no cost, refund estimated, small sample.
export function messyPayload(): AnalysisRpcPayload {
  const base = salesPayload();
  return {
    ...base,
    roles: {
      date: "date",
      product: "product",
      qty: "qty",
      unit_price: "unit_price",
    },
    quality: {
      rows: 4,
      columns: base.quality.columns.map((c) =>
        c.role === "date"
          ? { ...c, missing_pct: 75, role_confidence: "low" }
          : c.role === "product"
            ? { ...c, missing_pct: 50 }
            : c.role === "qty"
              ? { ...c, invalid_pct: 25, outlier: true }
              : c,
      ),
      flags: [],
    },
    kpis: {
      rows: 4,
      distinct_products: 2,
      revenue: 42,
      units: 8,
      cogs: null,
      expenses: null,
      gross_margin: null,
      gross_margin_pct: null,
      avg_transaction: null,
      min_date: null,
      max_date: null,
    },
    comparison: { label: null, current_value: null, prior_value: null, delta: null, delta_pct: null },
    refund: { gross_revenue: 42, refunds: null, refund_rows: null, refund_rate_pct: null, estimated: true },
    timeSeries: [],
    concentration: { available: false },
    topProducts: [],
    bottomProducts: [],
    topCategories: [],
    weekdayPattern: [],
    hourPattern: [],
  };
}