import { round, pctShare } from "./shared";

/**
 * Supplier lens (تحليل الموردين).
 *
 * Spend analysis over purchase/order lines: total spend, number of orders,
 * per-supplier share and top-N concentration, average unit price paid, and a
 * monthly purchasing trend. Pure and deterministic.
 */

export interface PurchaseLine {
  supplier: string | null;
  date: string;
  order: string | null;
  product: string | null;
  qty: number;
  /** line total (purchase_cost column or qty × unit cost). */
  cost: number;
  /** unit cost when derivable, else null. */
  unit_cost: number | null;
}

export interface SupplierRow {
  label: string;
  spend: number;
  share_pct: number | null;
  orders: number;
  avg_unit_cost: number | null;
}

export interface SupplierLensResult {
  totals: {
    spend: number;
    orders: number;
    lines: number;
    avg_order_value: number | null;
    suppliers: number;
  };
  suppliers: SupplierRow[];
  concentration: {
    top1_share_pct: number | null;
    top3_share_pct: number | null;
    supplier_count: number;
  };
  monthly: { period: string; spend: number; orders: number }[];
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export function runSupplierLens(lines: PurchaseLine[]): SupplierLensResult {
  const flags: SupplierLensResult["flags"] = [];
  if (lines.length === 0) {
    flags.push({ level: "high", message: "No purchase lines — the supplier lens is empty." });
  }

  const bySupplier = new Map<string, { spend: number; orders: Set<string>; costs: number[] }>();
  const monthly = new Map<string, { spend: number; orders: Set<string> }>();

  let totalSpend = 0;
  let totalOrders = 0;

  for (const l of lines) {
    const supplier = l.supplier;
    if (supplier == null || supplier === "") continue;
    const s = bySupplier.get(supplier) ?? { spend: 0, orders: new Set<string>(), costs: [] };
    const isRefund = l.cost < 0;
    s.spend += Math.abs(l.cost);
    if (l.order) s.orders.add(l.order);
    if (!isRefund && l.unit_cost != null && l.qty > 0) s.costs.push(l.unit_cost);
    bySupplier.set(supplier, s);

    totalSpend += Math.abs(l.cost);
    if (l.order) totalOrders += 1;

    const period = String(l.date).slice(0, 7);
    if (period && period !== "") {
      const m = monthly.get(period) ?? { spend: 0, orders: new Set<string>() };
      m.spend += Math.abs(l.cost);
      if (l.order) m.orders.add(l.order);
      monthly.set(period, m);
    }
  }

  const suppliers: SupplierRow[] = [...bySupplier.entries()]
    .map(([label, v]) => ({
      label,
      spend: round(v.spend),
      share_pct: pctShare(v.spend, totalSpend),
      orders: v.orders.size,
      avg_unit_cost: v.costs.length > 0 ? round(sum(v.costs) / v.costs.length) : null,
    }))
    .sort((a, b) => b.spend - a.spend);

  const top3 = suppliers.slice(0, 3);
  const top1Share = suppliers[0]?.share_pct ?? null;
  const top3Share =
    top3.length > 0 && totalSpend > 0
      ? round((top3.reduce((a, s) => a + s.spend, 0) / totalSpend) * 100)
      : null;

  if (suppliers.length <= 1 && suppliers.length > 0) {
    flags.push({ level: "medium", message: "Only one supplier detected — concentration metrics are trivial. Add all vendors to the purchases sheet." });
  }

  return {
    totals: {
      spend: round(totalSpend),
      orders: totalOrders,
      lines: lines.length,
      avg_order_value: totalOrders > 0 ? round(totalSpend / totalOrders) : null,
      suppliers: suppliers.length,
    },
    suppliers,
    concentration: {
      top1_share_pct: top1Share,
      top3_share_pct: top3Share,
      supplier_count: suppliers.length,
    },
    monthly: [...monthly.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([period, v]) => ({ period, spend: round(v.spend), orders: v.orders.size })),
    flags,
  };
}

function sum(values: number[]): number {
  let acc = 0;
  for (const v of values) acc += v;
  return acc;
}