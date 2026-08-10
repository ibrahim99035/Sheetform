import type { ColumnDef, ColumnStats } from "./types";

export interface ComputedColumnStats {
  min: number | null;
  max: number | null;
  avg: number | null;
  sum: number | null;
  distinct_count: number;
  null_count: number;
}

export function computeColumnStats(
  rows: Array<{ data: Record<string, unknown> }>,
  columnDefs: ColumnDef[],
): Record<string, ComputedColumnStats> {
  const result: Record<string, ComputedColumnStats> = {};

  for (const def of columnDefs) {
    const numericValues: number[] = [];
    const distinct = new Set<string>();
    let nullCount = 0;

    for (const row of rows) {
      const value = row.data[def.key];
      if (value === null || value === undefined) {
        nullCount += 1;
        continue;
      }
      distinct.add(JSON.stringify(value));
      if (def.type === "numeric" && typeof value === "number") {
        numericValues.push(value);
      }
    }

    let min: number | null = null;
    let max: number | null = null;
    let sum: number | null = null;
    for (const n of numericValues) {
      if (min === null || n < min) min = n;
      if (max === null || n > max) max = n;
      sum = (sum ?? 0) + n;
    }
    const avg =
      numericValues.length > 0 ? (sum ?? 0) / numericValues.length : null;

    result[def.key] = {
      min,
      max,
      avg,
      sum,
      distinct_count: distinct.size,
      null_count: nullCount,
    };
  }

  return result;
}

export function toStatsRows(
  datasetId: string,
  stats: Record<string, ComputedColumnStats>,
): Array<Omit<ColumnStats, "computed_at">> {
  return Object.entries(stats).map(([column_key, s]) => ({
    dataset_id: datasetId,
    column_key,
    min: s.min,
    max: s.max,
    avg: s.avg,
    sum: s.sum,
    distinct_count: s.distinct_count,
    null_count: s.null_count,
  }));
}
