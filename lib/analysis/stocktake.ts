import { round } from "./shared";

/**
 * Physical stock count lens (الجرد الفعلي).
 *
 * Compares a counted quantity (stocktake sheet) against the system stock and
 * reports per-product/batch variance, adjusted units and (when a cost column
 * is available) the financial impact of the variance. Pure and deterministic.
 */

export interface StocktakeLine {
  product: string;
  batch: string | null;
  counted_qty: number;
}

export interface SystemStockLine {
  product: string;
  batch: string | null;
  system_qty: number;
  unit_cost: number | null;
}

export interface StocktakeRow {
  product: string;
  batch: string | null;
  system_qty: number;
  counted_qty: number;
  variance: number;
  variance_pct: number | null;
  adjustment_value: number | null;
}

export interface StocktakeResult {
  rows: StocktakeRow[];
  totals: {
    system_units: number;
    counted_units: number;
    variance_units: number;
    mismatch_lines: number;
    variance_value: number;
  };
  adjusted: StocktakeRow[];
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export function runStocktake(
  counts: StocktakeLine[],
  system: SystemStockLine[],
): StocktakeResult {
  const flags: StocktakeResult["flags"] = [];

  if (counts.length === 0) {
    flags.push({ level: "high", message: "No counted lines — import a stock-count sheet to run the audit." });
  }
  if (system.length === 0) {
    flags.push({ level: "medium", message: "No system stock available — variance is measured against counted-only rows (all treated as variance)." });
  }

  const systemByKey = new Map<string, SystemStockLine>();
  for (const s of system) {
    const key = stockKey(s.product, s.batch);
    const cur = systemByKey.get(key) ?? { product: s.product, batch: s.batch, system_qty: 0, unit_cost: null };
    cur.system_qty += s.system_qty;
    if (s.unit_cost != null) cur.unit_cost = s.unit_cost;
    systemByKey.set(key, cur);
  }

  const rows: StocktakeRow[] = counts.map((c) => {
    const sys = systemByKey.get(stockKey(c.product, c.batch));
    const systemQty = sys?.system_qty ?? 0;
    const variance = c.counted_qty - systemQty;
    return {
      product: c.product,
      batch: c.batch,
      system_qty: systemQty,
      counted_qty: c.counted_qty,
      variance,
      variance_pct: systemQty !== 0 ? round((variance / Math.abs(systemQty)) * 100) : null,
      adjustment_value: variance !== 0 && sys?.unit_cost != null && Number.isFinite(sys.unit_cost) ? round(variance * sys.unit_cost) : null,
    };
  });

  const mismatches = rows.filter((r) => r.variance !== 0);
  const adjusted = [...mismatches].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const totals = {
    system_units: sum(rows.map((r) => r.system_qty)),
    counted_units: sum(rows.map((r) => r.counted_qty)),
    variance_units: sum(rows.map((r) => r.variance)),
    mismatch_lines: mismatches.length,
    variance_value: round(sum(rows.map((r) => r.adjustment_value ?? 0))),
  };

  if (totals.mismatch_lines > 0) {
    flags.push({
      level: totals.mismatch_lines / Math.max(1, rows.length) > 0.25 ? "high" : "medium",
      message: `${totals.mismatch_lines} of ${rows.length} lines differ from the system — review ${totals.variance_units > 0 ? "gains" : "shrinkage"} before posting adjustments.`,
    });
  } else if (rows.length > 0) {
    flags.push({ level: "low", message: "Counted rows match the system exactly — no adjustment needed." });
  }

  return { rows, totals, adjusted, flags };
}

function stockKey(product: string, batch: string | null): string {
  return `${product}\u0000${batch ?? ""}`;
}

function sum(values: number[]): number {
  let acc = 0;
  for (const v of values) acc += v;
  return acc;
}