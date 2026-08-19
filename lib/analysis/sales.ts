import { round, pctShare } from "./shared";

/**
 * Sales lens (تحليل البيع).
 *
 * Pure, deterministic roll-ups over normalized sales lines: totals, monthly
 * and weekday trends, category and product mix, refund rate, and — when a
 * sales-rep / sales-team column exists — the performance breakdown by person
 * and team. No I/O, no randomness.
 */

export interface SalesLine {
  date: string;
  product: string;
  category: string | null;
  /** revenue value of the line (monetary column or qty × unit price). */
  amount: number;
  units: number;
  transaction_id: string | null;
  /** true when the line is a refund/return (explicit column or negative value). */
  refunded: boolean;
  rep: string | null;
  team: string | null;
}

export interface SalesRankRow {
  label: string;
  value: number;
  share_pct: number | null;
  units: number;
}

export interface SalesLensResult {
  totals: {
    revenue: number;
    units: number;
    transactions: number;
    avg_ticket: number | null;
    avg_basket_units: number | null;
    refund_pct: number | null;
  };
  monthly: { period: string; revenue: number; units: number }[];
  weekday: { day: string; revenue: number; units: number; transactions: number }[];
  categories: SalesRankRow[];
  products: SalesRankRow[];
  byRep: SalesRankRow[] | null;
  byTeam: SalesRankRow[] | null;
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthlyKey(date: string): string {
  return String(date).slice(0, 7);
}

function bucketBy<T>(
  rows: T[],
  keyOf: (r: T) => string | null,
  amountOf: (r: T) => number,
  unitsOf: (r: T) => number,
): Map<string, { value: number; units: number }> {
  const out = new Map<string, { value: number; units: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k == null || k === "") continue;
    const cur = out.get(k) ?? { value: 0, units: 0 };
    cur.value += amountOf(r);
    cur.units += unitsOf(r);
    out.set(k, cur);
  }
  return out;
}

function ranked(
  map: Map<string, { value: number; units: number }>,
  total: number,
  limit?: number,
): SalesRankRow[] {
  return [...map.entries()]
    .map(([label, { value, units }]) => ({
      label,
      value: round(value),
      share_pct: pctShare(value, total),
      units,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit ?? map.size);
}

export function runSalesLens(lines: SalesLine[]): SalesLensResult {
  const flags: SalesLensResult["flags"] = [];

  let revenue = 0;
  let units = 0;
  let refundedValue = 0;
  const txns = new Set<string>();
  const categories = bucketBy(lines, (l) => l.category, (l) => l.amount, (l) => l.units);
  const products = bucketBy(lines, (l) => l.product, (l) => l.amount, (l) => l.units);
  const monthly = bucketBy(lines, (l) => monthlyKey(l.date), (l) => l.amount, (l) => l.units);
  const weekday = new Map<string, { revenue: number; units: number; transactions: number }>();
  const reps = bucketBy(lines, (l) => l.rep, (l) => l.amount, (l) => l.units);
  const teams = bucketBy(lines, (l) => l.team, (l) => l.amount, (l) => l.units);

  for (const l of lines) {
    if (l.refunded) {
      refundedValue += Math.abs(l.amount);
    } else {
      revenue += l.amount;
      units += l.units;
    }
    if (l.transaction_id) txns.add(l.transaction_id);
    const day = parseDayName(l.date);
    if (day) {
      const w = weekday.get(day) ?? { revenue: 0, units: 0, transactions: 0 };
      w.revenue += l.amount;
      w.units += l.units;
      w.transactions += l.transaction_id ? 1 : 0;
      weekday.set(day, w);
    }
  }

  const txn = txns.size;
  const totalValue = revenue + refundedValue;

  if (lines.length === 0) {
    flags.push({ level: "high", message: "No sales lines — the sales lens is empty." });
  }
  if (lines.some((l) => l.refunded)) {
    flags.push({ level: "low", message: "Refund rate counts lines with negative values or an explicit refund column." });
  }
  if (lines.every((l) => l.rep == null)) {
    flags.push({ level: "low", message: "No sales-rep column — performance is not broken down by representative." });
  }

  const weekdayList = [...weekday.entries()]
    .map(([day, v]) => ({ day, revenue: round(v.revenue), units: v.units, transactions: v.transactions }))
    .sort((a, b) => (DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day)));

  return {
    totals: {
      revenue: round(revenue),
      units,
      transactions: txn,
      avg_ticket: txn > 0 ? round(revenue / txn) : null,
      avg_basket_units: txn > 0 ? round(units / txn, 1) : null,
      refund_pct: totalValue > 0 ? pctShare(refundedValue, totalValue) : null,
    },
    monthly: [...monthly.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([period, v]) => ({ period, revenue: round(v.value), units: v.units })),
    weekday: weekdayList,
    categories: ranked(categories, totalValue),
    products: ranked(products, totalValue),
    byRep: lines.some((l) => l.rep != null) ? ranked(reps, totalValue) : null,
    byTeam: lines.some((l) => l.team != null) ? ranked(teams, totalValue) : null,
    flags,
  };
}

function parseDayName(date: string): string | null {
  const d = new Date(String(date));
  if (Number.isNaN(d.getTime())) return null;
  return DAY_NAMES[d.getUTCDay()] ?? null;
}