import { round, pctShare, mean } from "./shared";

/**
 * Cross-pharmacy benchmarking payloads (opt-in).
 *
 * The control plane only ever receives daily/category AGGRECATES plus a
 * `patient_hash` namespace (when a patient column was present) so repeat counts
 * stay joinable without exposing raw identifiers. All row-level data is
 * dropped before uplink — see lib/privacy.ts.
 */

export interface DailyRollup {
  branch?: string | null;
  day: string;
  revenue: number;
  units: number;
  transactions: number;
  distinct_products: number;
}

export interface CategoryRollup {
  category: string;
  revenue: number;
  units: number;
  share_pct: number | null;
}

export interface BenchmarkPayload {
  tenant_id: string;
  region: string | null;
  days: DailyRollup[];
  categories: CategoryRollup[];
  patient_count: number;
  hashed_patients: boolean;
  computed_at: string;
}

/** Daily revenue/units/transactions from raw sales lines. */
export function dailyRollups(
  rows: { branch?: string | null; date: string | number; amount?: number | null; units?: number | null; txn?: string | null; product?: string | null }[],
): DailyRollup[] {
  const txnKeys = new Map<string, Set<string>>();
  const products = new Map<string, Set<string>>();
  const units = new Map<string, number>();
  const revenue = new Map<string, number>();

  for (const r of rows) {
    const day = String(r.date).slice(0, 10);
    const key = `${r.branch ?? "_"}\u0000${day}`;
    revenue.set(key, (revenue.get(key) ?? 0) + (Number.isFinite(r.amount ?? null) ? (r.amount as number) : 0));
    units.set(key, (units.get(key) ?? 0) + (Number.isFinite(r.units ?? null) ? (r.units as number) : 0));
    const tset = txnKeys.get(key) ?? new Set<string>();
    if (r.txn) tset.add(String(r.txn));
    txnKeys.set(key, tset);
    const pset = products.get(key) ?? new Set<string>();
    if (r.product) pset.add(String(r.product));
    products.set(key, pset);
  }

  const out: DailyRollup[] = [];
  for (const key of revenue.keys()) {
    const [branch, day] = key.split("\u0000");
    out.push({
      branch,
      day,
      revenue: round(revenue.get(key) ?? 0),
      units: round(units.get(key) ?? 0),
      transactions: txnKeys.get(key)?.size ?? 0,
      distinct_products: products.get(key)?.size ?? 0,
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || String(a.branch ?? "").localeCompare(String(b.branch ?? "")));
}

/** Category aggregates + revenue share. */
export function categoryRollups(
  rows: { category?: string | null; amount?: number | null; units?: number | null }[],
): CategoryRollup[] {
  const revenueMap = new Map<string, number>();
  const unitsMap = new Map<string, number>();
  for (const r of rows) {
    const cat = r.category ?? "(unknown)";
    revenueMap.set(cat, (revenueMap.get(cat) ?? 0) + (Number.isFinite(r.amount ?? null) ? (r.amount as number) : 0));
    unitsMap.set(cat, (unitsMap.get(cat) ?? 0) + (Number.isFinite(r.units ?? null) ? (r.units as number) : 0));
  }
  const total = [...revenueMap.values()].reduce((a, b) => a + b, 0);
  const out: CategoryRollup[] = [];
  for (const [category, revenue] of revenueMap) {
    out.push({
      category,
      revenue: round(revenue),
      units: unitsMap.get(category) ?? 0,
      share_pct: pctShare(revenue, total),
    });
  }
  return out.sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));
}

/** Cross-pharmacy comparison table produced FROM pre-aggregated opt-ins. */
export interface BenchmarkComparison {
  metric: string;
  ours: number | null;
  market: number | null;
  delta_pct: number | null;
}

/** Compare a tenant daily average vs market (excluding own-tenant) averages. */
export function compareToMarket(
  ourAverages: Record<string, number>,
  marketAverages: Record<string, number>,
): BenchmarkComparison[] {
  const metrics = new Set([...Object.keys(ourAverages), ...Object.keys(marketAverages)]);
  const out: BenchmarkComparison[] = [];
  for (const metric of [...metrics].sort()) {
    const ours = ourAverages[metric] ?? null;
    const market = marketAverages[metric] ?? null;
    let delta: number | null = null;
    if (ours !== null && market !== null && market !== 0) {
      delta = round(((ours - market) / market) * 100);
    }
    out.push({ metric, ours: ours === null ? null : round(ours), market: market === null ? null : round(market), delta_pct: delta });
  }
  return out;
}

/** Average daily per-branch metrics (the shape that gets uploaded per tenant). */
export function tenantDailyAverages(
  rows: { date: string | number; amount?: number | null; units?: number | null; txn?: string | null }[],
): Record<string, number> {
  const days = dailyRollups(rows as never);
  if (days.length === 0) return {};
  const totals = {
    revenue: mean(days.map((d) => d.revenue)) ?? 0,
    units: mean(days.map((d) => d.units)) ?? 0,
    transactions: mean(days.map((d) => d.transactions)) ?? 0,
    distinct_products: mean(days.map((d) => d.distinct_products)) ?? 0,
  };
  return {
    avg_daily_revenue: totals.revenue,
    avg_daily_units: totals.units,
    avg_daily_transactions: totals.transactions,
    avg_daily_distinct_products: totals.distinct_products,
    avg_transaction_value: totals.transactions > 0 ? totals.revenue / totals.transactions : 0,
  };
}