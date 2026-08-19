import { round, pctShare } from "./shared";

/**
 * Budget vs actual lens (الموازنات المالية).
 *
 * Compares a budget/target column against actual revenue/units for the same
 * period bucket (month when a date column exists, else a single period).
 * Variance and attainment (actual ÷ budget) are reported per period/category.
 * Pure and deterministic.
 */

export interface BudgetLine {
  period: string;
  category: string | null;
  branch: string | null;
  budget: number;
  actual: number;
  units: number;
}

export interface BudgetRow {
  period: string;
  category: string | null;
  budget: number;
  actual: number;
  variance: number;
  attainment_pct: number | null;
}

export interface BudgetResult {
  rows: BudgetRow[];
  totals: {
    budget: number;
    actual: number;
    variance: number;
    attainment_pct: number | null;
  };
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export function runBudget(lines: BudgetLine[]): BudgetResult {
  const flags: BudgetResult["flags"] = [];

  if (lines.length === 0) {
    flags.push({ level: "high", message: "No budget lines — the budget lens is empty." });
  }
  if (lines.every((l) => l.budget === 0)) {
    flags.push({ level: "medium", message: "Budget values are all zero — attainment is undefined. Import a budget sheet with target amounts." });
  }

  const map = new Map<string, BudgetLine>();
  for (const l of lines) {
    const key = `${l.period}\u0001${l.category ?? ""}\u0001${l.branch ?? ""}`;
    const cur = map.get(key) ?? { period: l.period, category: l.category, branch: l.branch, budget: 0, actual: 0, units: 0 };
    cur.budget += l.budget;
    cur.actual += l.actual;
    cur.units += l.units;
    map.set(key, cur);
  }

  const rows: BudgetRow[] = [...map.values()]
    .map((r) => ({
      period: r.period,
      category: r.category,
      budget: round(r.budget),
      actual: round(r.actual),
      variance: round(r.actual - r.budget),
      attainment_pct: r.budget > 0 ? pctShare(r.actual, r.budget) : null,
    }))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : (a.category ?? "") < (b.category ?? "") ? -1 : 1));

  const totalBudget = sum(rows.map((r) => r.budget));
  const totalActual = sum(rows.map((r) => r.actual));

  return {
    rows,
    totals: {
      budget: round(totalBudget),
      actual: round(totalActual),
      variance: round(totalActual - totalBudget),
      attainment_pct: totalBudget > 0 ? pctShare(totalActual, totalBudget) : null,
    },
    flags,
  };
}

function sum(values: number[]): number {
  let acc = 0;
  for (const v of values) acc += v;
  return acc;
}