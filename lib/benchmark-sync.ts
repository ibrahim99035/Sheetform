import { round } from "./analysis/shared";
import type { DailyRollup, CategoryRollup } from "./analysis/benchmark";

/** Numeric coercion matching the engine's projection (strips currency/symbols). */
export function coerceNumeric(v: unknown): number {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Opt-in benchmarking uplink payload assembly (pure).
 *
 * The payload is the ONLY thing that ever reaches the control plane — pre
 * computed daily/category aggregates in the KB range. No raw rows and no
 * patient identifiers are ever included: rollups are produced from the
 * projected sales lines (branch/date/amount/units/txn/product/category), and
 * patient identity is excluded at projection time.
 */

/** Projected sales line fields the payload builder consumes. */
export interface BenchmarkSalesLine {
  category?: string | null;
  amount?: number | null;
  /** Rounded line cost ($$$), only meaningful when the source has a cost column. */
  cost?: number | null;
}

/** A category rollup enriched with gross-margin % for the uplink. */
export interface BenchmarkPayloadCategory extends CategoryRollup {
  margin_pct: number | null;
}

export interface BenchmarkPayload {
  days: DailyRollup[];
  categories: BenchmarkPayloadCategory[];
  computed_at: string;
}

/**
 * Per-category gross margin: (revenue − cost) / revenue, as a percentage.
 *
 * When the dataset has no cost column (`hasCost = false`) every margin is
 * NULL — the RPC stores NULL (`avg_margin`) and market averages simply skip
 * margin-less tenants. Zero-cost categories within a cost-bearing dataset are
 * reported as NULL rather than a misleading 100% margin.
 */
export function categoryMargins(
  lines: BenchmarkSalesLine[],
  hasCost: boolean,
): Map<string, number | null> {
  const rev = new Map<string, number>();
  const cst = new Map<string, number>();
  for (const l of lines) {
    const cat = l.category ?? "(unknown)";
    const r = coerceNumeric(l.amount);
    const c = hasCost ? coerceNumeric(l.cost) : 0;
    rev.set(cat, (rev.get(cat) ?? 0) + r);
    if (hasCost) cst.set(cat, (cst.get(cat) ?? 0) + c);
  }
  const out = new Map<string, number | null>();
  for (const cat of rev.keys()) {
    const r = rev.get(cat) ?? 0;
    const c = cst.get(cat) ?? 0;
    out.set(cat, hasCost && r > 0 ? round(((r - c) / r) * 100) : null);
  }
  return out;
}

/**
 * Assemble the KB uplink payload from the module's rollups + margins.
 * `days`/`categories` are the exact shapes the Benchmark card renders, so what
 * is displayed and what is uploaded are always consistent.
 */
export function buildBenchmarkPayload(input: {
  daily: DailyRollup[];
  categories: CategoryRollup[];
  margins?: Map<string, number | null> | Record<string, number | null>;
  computedAt?: string;
}): BenchmarkPayload {
  const marginMap =
    input.margins instanceof Map
      ? input.margins
      : new Map(Object.entries(input.margins ?? {}));
  return {
    days: input.daily.map((d) => ({ ...d })),
    categories: input.categories.map((c) => ({
      ...c,
      margin_pct: marginMap.get(c.category) ?? null,
    })),
    computed_at: input.computedAt ?? new Date().toISOString(),
  };
}