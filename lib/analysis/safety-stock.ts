import { mean, round, stddev } from "./shared";

/**
 * Continuous-review inventory parameters:
 *   SafetyStock  = z · σ_d · √L
 *   ReorderPoint = d · L + SafetyStock
 * where d = expected daily demand, σ_d = std.dev. of daily demand,
 * L = lead time in days, z = service-level safety factor.
 *
 * This is the textbook (uncorrelated daily demand) model; it assumes demand
 * variance scales linearly with lead time. For correlated/skewed demand the
 * square-root rule understates buffers — callers can raise the service level.
 */

export type ServiceLevel = 90 | 95 | 97.5 | 98 | 99;

/** One-sided z for a target stock-out service level (plan default 95 → 1.65). */
export const Z_TABLE: Record<ServiceLevel, number> = {
  90: 1.28,
  95: 1.65,
  97.5: 1.96,
  98: 2.05,
  99: 2.33,
};

export interface SafetyStockOptions {
  leadTimeDays?: number;
  serviceLevel?: ServiceLevel;
  /** products with fewer demand days fall back to this share of the total-day variance. */
  minHistoryDays?: number;
}

export interface SafetyStockItem {
  product: string;
  avg_daily_demand: number;
  demand_stddev: number;
  lead_time_days: number;
  service_level: number;
  z: number;
  safety_stock: number;
  reorder_point: number;
  history_days: number;
  insufficient_history: boolean;
}

export interface SafetyStockResult {
  items: SafetyStockItem[];
  flags: { level: "high" | "medium" | "low"; message: string }[];
  params: { leadTimeDays: number; serviceLevel: number; z: number };
}

export function zFor(serviceLevel: ServiceLevel): number {
  return Z_TABLE[serviceLevel] ?? Z_TABLE[95];
}

/** Ideal safety stock when demand is fully known (pure integer smoothing). */
export function safetyStock(dailyDemand: number[], leadTimeDays: number, z: number): number {
  const s = stddev(dailyDemand) ?? 0;
  return Math.ceil(z * s * Math.sqrt(Math.max(1, leadTimeDays)) * 100) / 100;
}

export function reorderPoint(
  avgDailyDemand: number,
  demandStddev: number,
  leadTimeDays: number,
  z: number,
): number {
  return Math.ceil((avgDailyDemand * leadTimeDays + z * demandStddev * Math.sqrt(Math.max(1, leadTimeDays))) * 100) / 100;
}

/** CEIL to whole units for products that can't be split (packs). */
export function integerUnits(v: number): number {
  return Math.ceil(v);
}

export function runSafetyStock(
  demandByProduct: Map<string, number[]>,
  options?: SafetyStockOptions,
): SafetyStockResult {
  const leadTimeDays = options?.leadTimeDays ?? 7;
  const serviceLevel = options?.serviceLevel ?? 95;
  const minHistoryDays = options?.minHistoryDays ?? 7;
  const z = zFor(serviceLevel);

  const items: SafetyStockItem[] = [];
  let insufficientCount = 0;

  for (const [product, series] of demandByProduct) {
    const historyDays = series.length;
    const insufficient = historyDays < minHistoryDays;
    if (insufficient) insufficientCount += 1;
    const avg = mean(series) ?? 0;
    // With limited history, dampen the variance estimate toward the single-day
    // spread so we never output zero buffers on partial data.
    const s = stddev(series) ?? (series.length > 0 ? Math.abs(series[0]) * 0.5 : 0);
    items.push({
      product,
      avg_daily_demand: round(avg),
      demand_stddev: round(s),
      lead_time_days: leadTimeDays,
      service_level: serviceLevel,
      z,
      safety_stock: round(safetyStock(series.map((v) => v), leadTimeDays, z)),
      reorder_point: round(reorderPoint(avg, s, leadTimeDays, z)),
      history_days: historyDays,
      insufficient_history: insufficient,
    });
  }

  items.sort((a, b) => b.reorder_point - a.reorder_point || a.product.localeCompare(b.product));

  const flags: SafetyStockResult["flags"] = [];
  if (insufficientCount > 0) {
    flags.push({
      level: "medium",
      message: `${insufficientCount} products have fewer than ${minHistoryDays} demand days; buffers are dampened estimates. Build 2–4 weeks of demand history for exact values.`,
    });
  }
  if (items.length === 0) {
    flags.push({ level: "medium", message: "No demand data — safety stock could not be computed." });
  }

  return { items, flags, params: { leadTimeDays, serviceLevel, z } };
}