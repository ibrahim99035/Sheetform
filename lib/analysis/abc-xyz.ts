import { mean, coefficientOfVariation, round, pctShare, sum } from "./shared";

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";

export interface AbcXyzOptions {
  /** cumulative revenue share thresholds: A ≤ aShare, B ≤ bShare, rest C. */
  aShare?: number; // default 0.8
  bShare?: number; // default 0.95
  /** CV thresholds on daily demand: X < xCv, Y < yCv, rest Z. */
  xCv?: number; // default 0.1 (plan of record)
  yCv?: number; // default 0.25
  /** counts n products per segment are unreliable below this many demand days. */
  minDemandDays?: number;
  /** only the top N products by revenue get XYZ (a subset is far faster). */
  xyzTopN?: number;
}

export interface AbcItem {
  product: string;
  revenue: number;
  revenue_share: number;
  cumulative_share: number;
  abc: AbcClass;
}

export interface XyzItem {
  product: string;
  avg_daily_units: number;
  cv: number | null;
  has_insufficient_history: boolean;
  xyz: XyzClass;
}

export interface AbcXyzResult {
  abc: AbcItem[];
  xyz: XyzItem[];
  matrix: { cell: string; products: string[]; count: number; revenue: number }[];
  flags: { level: "high" | "medium" | "low"; message: string }[];
  thresholds: { aShare: number; bShare: number; xCv: number; yCv: number };
}

export const DEFAULT_ABC_XYZ_OPTIONS: Required<AbcXyzOptions> = {
  aShare: 0.8,
  bShare: 0.95,
  xCv: 0.1,
  yCv: 0.25,
  minDemandDays: 7,
  xyzTopN: 200,
};

export function classifyAbc(cumulativeShare: number, aShare: number, bShare: number): AbcClass {
  if (cumulativeShare <= aShare) return "A";
  if (cumulativeShare <= bShare) return "B";
  return "C";
}

export function classifyXyz(cv: number | null, hasInsufficient: boolean, xCv: number, yCv: number): XyzClass {
  if (hasInsufficient) return "Z";
  if (cv === null) return "Z";
  if (cv < xCv) return "X";
  if (cv < yCv) return "Y";
  return "Z";
}

export interface DemandRow {
  product: string;
  day: string | number;
  units: number;
}

/** Per-product daily demand series. */
export function demandSeriesByProduct(rows: DemandRow[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const arr = map.get(r.product) ?? [];
    arr.push(typeof r.units === "number" && Number.isFinite(r.units) ? r.units : 0);
    map.set(r.product, arr);
  }
  return map;
}

export interface ProductRevenue {
  product: string;
  revenue: number;
}

/**
 * ABC stratification by cumulative revenue share. Sorted by revenue desc (ties
 * broken alphabetically for determinism), A ≤ aShare, B ≤ bShare.
 */
export function computeAbc(
  items: ProductRevenue[],
  options?: AbcXyzOptions,
): AbcItem[] {
  const opts = { ...DEFAULT_ABC_XYZ_OPTIONS, ...options };
  const sorted = [...items]
    .filter((i) => Number.isFinite(i.revenue))
    .sort((a, b) => b.revenue - a.revenue || a.product.localeCompare(b.product));
  const total = sum(sorted.map((s) => s.revenue));
  let cumulative = 0;
  return sorted.map((s) => {
    cumulative += s.revenue;
    const cumShare = total > 0 ? cumulative / total : 0;
    return {
      product: s.product,
      revenue: round(s.revenue),
      revenue_share: pctShare(s.revenue, total) ?? 0,
      cumulative_share: round(cumShare * 100),
      abc: classifyAbc(cumShare, opts.aShare, opts.bShare),
    };
  });
}

/**
 * XYZ stratification by coefficient of variation of DAILY demand per product.
 * Products with fewer than `minDemandDays` of history are marked
 * has_insufficient_history and classified Z (replenish conservatively).
 */
export function computeXyz(
  productDemand: Map<string, number[]>,
  options?: AbcXyzOptions,
): XyzItem[] {
  const opts = { ...DEFAULT_ABC_XYZ_OPTIONS, ...options };
  const out: XyzItem[] = [];
  for (const [product, series] of productDemand) {
    const insufficient = series.length < opts.minDemandDays;
    const cv = coefficientOfVariation(series);
    out.push({
      product,
      avg_daily_units: round(mean(series) ?? 0),
      cv: cv === null ? null : round(cv),
      has_insufficient_history: insufficient,
      xyz: classifyXyz(cv, insufficient, opts.xCv, opts.yCv),
    });
  }
  out.sort((a, b) => b.avg_daily_units - a.avg_daily_units || a.product.localeCompare(b.product));
  return out;
}

/** Join ABC and XYZ into the AX..CZ replenishment matrix. */
export function buildMatrix(abc: AbcItem[], xyz: XyzItem[]): AbcXyzResult["matrix"] {
  const byProduct = new Map(xyz.map((x) => [x.product, x]));
  const cells = ["A", "B", "C"].flatMap((a) =>
    ["X", "Y", "Z"].map((z) => ({ cell: `${a}${z}`, products: [] as string[], count: 0, revenue: 0 })),
  );
  const index = new Map(cells.map((c) => [c.cell, c]));
  for (const item of abc) {
    const xyzClass = byProduct.get(item.product)?.xyz ?? "Z";
    const cell = index.get(`${item.abc}${xyzClass}`);
    if (cell) {
      cell.products.push(item.product);
      cell.count += 1;
      cell.revenue += item.revenue;
    }
  }
  return cells.map((c) => ({ ...c, revenue: round(c.revenue) }));
}

/** Replenishment policy guidance per matrix cell (enterprise lexicon). */
export const MATRIX_POLICY: Record<string, { policy: string; label: string }> = {
  AX: { label: "High value · stable", policy: "Automate replenishment on a fixed calendar; min-max with tight tolerances." },
  AY: { label: "High value · variable", policy: "Automated with safety-stock buffers; monitor demand shifts weekly." },
  AZ: { label: "High value · erratic", policy: "Short-horizon review cycles; avoid deep stock, keep a strategic buffer." },
  BX: { label: "Mid value · stable", policy: "Automate with moderate buffer; reorder when stock crosses the reorder point." },
  BY: { label: "Mid value · variable", policy: "Review fortnightly; seasonal promotions to smooth demand." },
  BZ: { label: "Mid value · erratic", policy: "Maintain limited stock; pair with substitution advice at POS." },
  CX: { label: "Low value · stable", policy: "Periodic (monthly) order; batch to cut procurement overhead." },
  CY: { label: "Low value · variable", policy: "Consolidate orders; watch for slow movers tying up shelf space." },
  CZ: { label: "Low value · erratic", policy: "Minimal or drop-through (order-only) stock; revisit inclusion quarterly." },
};

export function runAbcXyz(
  revenue: ProductRevenue[],
  demand: DemandRow[],
  options?: AbcXyzOptions,
): AbcXyzResult {
  const opts = { ...DEFAULT_ABC_XYZ_OPTIONS, ...options };
  const abc = computeAbc(revenue, opts);
  const byDemand = demandSeriesByProduct(demand);
  const topProducts = new Set(
    abc.slice(0, opts.xyzTopN).map((a) => a.product),
  );
  const xyzInput = new Map<string, number[]>();
  for (const [p, series] of byDemand) {
    if (topProducts.has(p)) xyzInput.set(p, series);
  }
  const xyz = computeXyz(xyzInput, opts);
  const matrix = buildMatrix(abc, xyz);

  const flags: AbcXyzResult["flags"] = [];
  if (abc.length === 0) {
    flags.push({ level: "medium", message: "No revenue rows — ABC classification skipped." });
  }
  const unclassified = byDemand.size - xyz.length;
  if (unclassified > 0) {
    flags.push({
      level: "low",
      message: `${unclassified} products have demand history but no revenue (XYZ computed for the top ${opts.xyzTopN} by revenue).`,
    });
  }
  const insuff = xyz.filter((x) => x.has_insufficient_history).length;
  if (insuff > 0) {
    flags.push({
      level: "low",
      message: `${insuff} products have fewer than ${opts.minDemandDays} demand days and are conservatively classified Z.`,
    });
  }

  return { abc, xyz, matrix, flags, thresholds: { aShare: opts.aShare, bShare: opts.bShare, xCv: opts.xCv, yCv: opts.yCv } };
}