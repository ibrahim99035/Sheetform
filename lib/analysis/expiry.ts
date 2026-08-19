import { dayBucket, dayDiffDays, round, parseDay } from "./shared";

/**
 * Expiry-risk tracking for the inventory dataset.
 *
 * For each stock line we compute days-to-expiry (from a reference date) and
 * days-to-cover (stock_on_hand ÷ avg daily demand). A line is at risk when it
 * will be exhausted after the expiry date — i.e. stock would still be on hand
 * past its expiry. Financial exposure = stock_on_hand × unit_cost.
 */

export type ExpiryRisk = "urgent" | "at_risk" | "watch" | "ok" | "expired";

export interface InventoryLine {
  product: string;
  sku?: string | null;
  batch?: string | null;
  expiry_date: string | null;
  stock_on_hand: number;
  unit_cost?: number | null;
}

export interface DemandForProduct {
  product: string;
  avg_daily_units: number | null;
}

export interface ExpiryBucket {
  bucket: string;
  count: number;
  units: number;
  financial_exposure: number;
  risk: ExpiryRisk;
}

export interface ExpiringItem {
  product: string;
  sku: string | null;
  batch: string | null;
  expiry_date: string | null;
  stock_on_hand: number;
  days_to_expiry: number;
  days_to_cover: number | null;
  unit_cost: number | null;
  financial_exposure: number;
  risk: ExpiryRisk;
  note: string;
}

export interface ExpiryResult {
  reference_date: string;
  buckets: ExpiryBucket[];
  items: ExpiringItem[];
  at_risk_units: number;
  at_risk_exposure: number;
  total_stock_value: number;
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export const EXPIRY_WINDOWS: { risk: ExpiryRisk; bucket: string; maxDaysX0: number }[] = [
  { risk: "expired", bucket: "expired", maxDaysX0: -1 },
  { risk: "urgent", bucket: "0-30d", maxDaysX0: 30 },
  { risk: "at_risk", bucket: "31-90d", maxDaysX0: 90 },
  { risk: "watch", bucket: "91-180d", maxDaysX0: 180 },
];

export function riskFor(daysToExpiry: number, daysToCover: number | null, hasDemand: boolean): ExpiryRisk {
  const risk = EXPIRY_WINDOWS.find((w) => daysToExpiry <= w.maxDaysX0) ?? { risk: "ok" as ExpiryRisk };
  if (daysToExpiry <= 0) return "expired";
  // urgent only when we'd actually run out AFTER expiry (or demand is unknown).
  if (daysToCover !== null && hasDemand && daysToCover <= daysToExpiry && daysToExpiry <= 30) {
    return "urgent";
  }
  return risk.risk;
}

/** per-item note describing the action a pharmacy should take. */
export function actionNote(item: Omit<ExpiringItem, "note">): string {
  switch (item.risk) {
    case "expired":
      return "Expired — quarantine and write off; remove from sellable stock.";
    case "urgent":
      return "Will expire before exhausted — discount, return to supplier, or special-order for known customers.";
    case "at_risk":
      return "Expires within 90 days — put on the promotion shelf and rotate FIFO.";
    case "watch":
      return "Monitor monthly; keep FIFO signage.";
    default:
      return "Healthy shelf life.";
  }
}

export function runExpiry(
  lines: InventoryLine[],
  demand: DemandForProduct[],
  options?: { referenceDate?: string | number },
): ExpiryResult {
  const reference = new Date(options?.referenceDate ?? Date.now());
  const refDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const demandByProduct = new Map(demand.map((d) => [d.product, d.avg_daily_units]));

  const items: ExpiringItem[] = [];
  const buckets: Record<string, ExpiryBucket> = {};
  for (const b of EXPIRY_WINDOWS) buckets[b.bucket] = { bucket: b.bucket, count: 0, units: 0, financial_exposure: 0, risk: b.risk };
  // ok bucket tracks the "healthy" window (> 180d); expired/windows above
  buckets["180d+"] = { bucket: "180d+", count: 0, units: 0, financial_exposure: 0, risk: "ok" };

  let atRiskUnits = 0;
  let atRiskExposure = 0;
  let totalStockValue = 0;

  for (const line of lines) {
    const expiryDay = parseDay(line.expiry_date);
    const stock = Number.isFinite(line.stock_on_hand) ? line.stock_on_hand : 0;
    const cost = Number.isFinite(line.unit_cost ?? null) ? (line.unit_cost as number) : null;
    const exposure = cost === null ? 0 : stock * cost;
    totalStockValue += exposure;

    let item: ExpiringItem;
    if (expiryDay === null) {
      const avg = demandByProduct.get(line.product) ?? null;
      item = {
        product: line.product,
        sku: line.sku ?? null,
        batch: line.batch ?? null,
        expiry_date: line.expiry_date ?? null,
        stock_on_hand: stock,
        days_to_expiry: Infinity,
        days_to_cover: avg && avg > 0 ? round(stock / avg) : null,
        unit_cost: cost,
        financial_exposure: round(exposure),
        risk: "ok",
        note: "Expiry date missing — flag for stock verification.",
      };
      const b = buckets["180d+"];
      b.count += 1;
      b.units += stock;
      b.financial_exposure += exposure;
    } else {
      const daysToExpiry = dayDiffDays(refDay, expiryDay);
      const avg = demandByProduct.get(line.product) ?? null;
      const daysToCover = avg && avg > 0 ? stock / avg : null;
      const risk = riskFor(daysToExpiry, daysToCover, avg !== null && avg > 0);
      item = {
        product: line.product,
        sku: line.sku ?? null,
        batch: line.batch ?? null,
        expiry_date: line.expiry_date ?? null,
        stock_on_hand: stock,
        days_to_expiry: daysToExpiry,
        days_to_cover: daysToCover === null ? null : round(daysToCover),
        unit_cost: cost,
        financial_exposure: round(exposure),
        risk,
        note: actionNote({
          product: line.product, sku: line.sku ?? null, batch: line.batch ?? null,
          expiry_date: line.expiry_date ?? null, stock_on_hand: stock,
          days_to_expiry: daysToExpiry, days_to_cover: daysToCover === null ? null : round(daysToCover),
          unit_cost: cost, financial_exposure: round(exposure), risk,
        }),
      };
      const bucket = dayBucket(daysToExpiry);
      const b = buckets[bucket] ?? buckets["180d+"];
      b.count += 1;
      b.units += stock;
      b.financial_exposure += exposure;
      if (risk === "urgent" || risk === "at_risk" || risk === "expired") {
        atRiskUnits += stock;
        atRiskExposure += exposure;
      }
    }
    items.push(item);
  }

  items.sort((a, b) => (a.days_to_expiry === Infinity ? 1 : a.days_to_expiry) - (b.days_to_expiry === Infinity ? 1 : b.days_to_expiry));

  const bucketList = Object.values(buckets).map((b) => ({
    bucket: b.bucket,
    count: b.count,
    units: b.units,
    financial_exposure: round(b.financial_exposure),
    risk: b.risk,
  }));

  const missingExpiry = lines.filter((l) => l.expiry_date == null).length;
  const flags: ExpiryResult["flags"] = [];
  if (lines.length === 0) {
    flags.push({ level: "high", message: "No inventory lines — expiry tracking skipped." });
  }
  if (missingExpiry > 0) {
    flags.push({ level: "low", message: `${missingExpiry} lines have no expiry date (kept separate, flagged for stock verification).` });
  }
  const noDemand = items.filter((i) => i.days_to_cover === null && i.days_to_expiry !== Infinity).length;
  if (noDemand > 0) {
    flags.push({
      level: "low",
      message: `${noDemand} lines have no matching sales demand — days-to-cover unknown; expiry risk is based on date alone.`,
    });
  }

  return {
    reference_date: new Date(refDay).toISOString().slice(0, 10),
    buckets: bucketList,
    items,
    at_risk_units: atRiskUnits,
    at_risk_exposure: round(atRiskExposure),
    total_stock_value: round(totalStockValue),
    flags,
  };
}