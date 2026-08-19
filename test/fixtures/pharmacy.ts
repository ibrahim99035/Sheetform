import type { ColumnDef } from "@/lib/types";

/**
 * Deterministic pharmacy sales + inventory fixtures for the analytics suite.
 *
 * The sales dataset mirrors a small POS register: 3 days in July 2026, 9
 * transactions, 4 products, 2 branches, 6 customers (one walk-in).
 */

export const salesColumnDefs: ColumnDef[] = [
  { key: "date", label: "Date", type: "date", role: "date", role_confidence: "high" },
  { key: "transaction_id", label: "Transaction ID", type: "string", role: "transaction_id", role_confidence: "high" },
  { key: "product", label: "Product", type: "string", role: "product", role_confidence: "high" },
  { key: "category", label: "Category", type: "string", role: "category", role_confidence: "high" },
  { key: "qty", label: "Quantity", type: "numeric", role: "qty", role_confidence: "high" },
  { key: "unit_price", label: "Unit price", type: "numeric", role: "unit_price", role_confidence: "high" },
  { key: "cost", label: "Unit cost", type: "numeric", role: "cost", role_confidence: "medium" },
  { key: "patient", label: "Patient", type: "string", role: "patient", role_confidence: "high" },
  { key: "branch", label: "Branch", type: "string", role: "branch", role_confidence: "high" },
];

export interface SalesRow {
  date: string;
  transaction_id: string;
  product: string;
  category: string;
  qty: number;
  unit_price: number;
  cost: number;
  patient: string | null;
  branch: string;
}

export const PRODUCTS: Record<string, { category: string; price: number; cost: number }> = {
  "Amoxil 500": { category: "Antibiotics", price: 20, cost: 8 },
  Paracetamol: { category: "Analgesics", price: 6, cost: 2 },
  "Vit C": { category: "Vitamins", price: 10, cost: 4 },
  Saline: { category: "Medical", price: 4, cost: 1 },
};

const row = (r: SalesRow): Record<string, unknown> => {
  const p = PRODUCTS[r.product];
  return {
    date: r.date,
    transaction_id: r.transaction_id,
    product: r.product,
    category: r.category ?? p.category,
    qty: r.qty,
    unit_price: r.unit_price ?? p.price,
    cost: r.cost ?? p.cost,
    patient: r.patient,
    branch: r.branch,
  };
};

export const salesRows: Record<string, unknown>[] = [
  row({ date: "2026-07-01", transaction_id: "T1", product: "Amoxil 500", category: "Antibiotics", qty: 2, unit_price: 20, cost: 8, patient: "P1", branch: "Main" }),
  row({ date: "2026-07-01", transaction_id: "T1", product: "Paracetamol", category: "Analgesics", qty: 1, unit_price: 6, cost: 2, patient: "P1", branch: "Main" }),
  row({ date: "2026-07-01", transaction_id: "T2", product: "Vit C", category: "Vitamins", qty: 1, unit_price: 10, cost: 4, patient: "P2", branch: "North" }),
  row({ date: "2026-07-01", transaction_id: "T3", product: "Saline", category: "Medical", qty: 2, unit_price: 4, cost: 1, patient: null, branch: "Main" }),
  row({ date: "2026-07-02", transaction_id: "T4", product: "Amoxil 500", category: "Antibiotics", qty: 1, unit_price: 20, cost: 8, patient: "P1", branch: "Main" }),
  row({ date: "2026-07-02", transaction_id: "T4", product: "Vit C", category: "Vitamins", qty: 1, unit_price: 10, cost: 4, patient: "P1", branch: "Main" }),
  row({ date: "2026-07-02", transaction_id: "T5", product: "Paracetamol", category: "Analgesics", qty: 3, unit_price: 6, cost: 2, patient: "P3", branch: "North" }),
  row({ date: "2026-07-02", transaction_id: "T6", product: "Amoxil 500", category: "Antibiotics", qty: 1, unit_price: 20, cost: 8, patient: "P2", branch: "North" }),
  row({ date: "2026-07-03", transaction_id: "T7", product: "Saline", category: "Medical", qty: 1, unit_price: 4, cost: 1, patient: "P1", branch: "Main" }),
  row({ date: "2026-07-03", transaction_id: "T7", product: "Paracetamol", category: "Analgesics", qty: 2, unit_price: 6, cost: 2, patient: "P1", branch: "Main" }),
  row({ date: "2026-07-03", transaction_id: "T8", product: "Amoxil 500", category: "Antibiotics", qty: 1, unit_price: 20, cost: 8, patient: "P4", branch: "Main" }),
  row({ date: "2026-07-03", transaction_id: "T9", product: "Paracetamol", category: "Analgesics", qty: 1, unit_price: 6, cost: 2, patient: "P5", branch: "North" }),
  row({ date: "2026-07-04", transaction_id: "T10", product: "Amoxil 500", category: "Antibiotics", qty: 1, unit_price: 20, cost: 8, patient: "P6", branch: "Main" }),
  row({ date: "2026-07-04", transaction_id: "T10", product: "Paracetamol", category: "Analgesics", qty: 1, unit_price: 6, cost: 2, patient: "P6", branch: "Main" }),
];

// Inventory view for the same products (expiry risk module).
export const inventoryRows: Record<string, unknown>[] = [
  { product: "Amoxil 500", expiry_date: "2026-08-01", stock_on_hand: 100, unit_cost: 8 },
  { product: "Paracetamol", expiry_date: "2026-06-01", stock_on_hand: 50, unit_cost: 2 },
  { product: "Vit C", expiry_date: "2026-09-01", stock_on_hand: 30, unit_cost: 4 },
  { product: "Saline", expiry_date: null, stock_on_hand: 20, unit_cost: 1 },
];

export const inventoryColumnDefs: ColumnDef[] = [
  { key: "product", label: "Product", type: "string", role: "product", role_confidence: "high" },
  { key: "expiry_date", label: "Expiry date", type: "date", role_confidence: "high" },
  { key: "stock_on_hand", label: "Stock on hand", type: "numeric", role_confidence: "high" },
  { key: "unit_cost", label: "Unit cost", type: "numeric", role_confidence: "medium" },
];

// Stable daily demand per product derived from salesRows (used by expiry /
// safety-stock tests without re-deriving from the orchestrator).
export const avgDailyDemand: { product: string; avg_daily_units: number }[] = [
  { product: "Amoxil 500", avg_daily_units: 5 },
  { product: "Paracetamol", avg_daily_units: 3 },
  { product: "Vit C", avg_daily_units: 1 },
  { product: "Saline", avg_daily_units: 1 },
];