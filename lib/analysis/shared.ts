/**
 * Shared numeric/statistical helpers for the deterministic analytics modules.
 * All functions are pure and unit-testable; no I/O, no randomness.
 */

export type Availability =
  | { ok: true }
  | { ok: false; reason: string };

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Population standard deviation (the textbook σ used by CV / safety stock). */
export function stddev(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length === 0) return null;
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

/** Coefficient of variation; null when mean is 0 (demand vector has no volume). */
export function coefficientOfVariation(values: number[]): number | null {
  const m = mean(values);
  const s = stddev(values);
  if (m === null || s === null || m === 0) return null;
  return s / m;
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function pctShare(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return null;
  return round((value / total) * 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic quantile bucket (1..bands) over an ascending-sorted array,
 * mirroring SQL NTILE semantics: the i-th element (0-based) of n gets
 * rank = floor(i * bands / n) + 1. Ties are not special-cased (matching NTILE).
 * `invert` flips the ordering so a LOW raw value scores HIGH (recency).
 */
export function ntileRank(values: number[], value: number, bands: number, invert = false): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  let index = sorted.findIndex((v) => v >= value);
  index = index === -1 ? sorted.length - 1 : index;
  // find upper bound: highest index with same value keeps determinism
  while (index + 1 < sorted.length && sorted[index + 1] === value) index += 1;
  let rank = Math.floor((index / values.length) * bands) + 1;
  if (invert) rank = bands - rank + 1;
  return clamp(rank, 1, bands);
}

/** Group consecutive integers into labelled buckets for display. */
export function dayBucket(days: number): string {
  if (days < 0) return "expired";
  if (days <= 30) return "0-30d";
  if (days <= 90) return "31-90d";
  if (days <= 180) return "91-180d";
  return "180d+";
}

export function sum(values: number[]): number {
  let acc = 0;
  for (const v of values) acc += v;
  return acc;
}

export function parseDay(s: unknown): number | null {
  if (s == null || s === "") return null;
  const d = new Date(typeof s === "number" ? s : String(s));
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function dayDiffDays(fromDay: number, toDay: number): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((toDay - fromDay) / MS_PER_DAY);
}