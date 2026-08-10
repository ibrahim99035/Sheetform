import { describe, expect, it } from "vitest";
import { computeColumnStats, toStatsRows } from "@/lib/stats";
import type { ColumnDef } from "@/lib/types";

const defs: ColumnDef[] = [
  { key: "amount", label: "Amount", type: "numeric" },
  { key: "category", label: "Category", type: "string" },
  { key: "created", label: "Created", type: "date" },
];

const rows = [
  { data: { amount: 10, category: "A", created: "2024-01-01T00:00:00.000Z" } },
  { data: { amount: 20, category: "A", created: "2024-01-02T00:00:00.000Z" } },
  { data: { amount: 30, category: "B", created: "2024-01-03T00:00:00.000Z" } },
  { data: { amount: null, category: null, created: null } },
];

describe("computeColumnStats", () => {
  it("computes numeric aggregates", () => {
    const stats = computeColumnStats(rows, defs);
    expect(stats.amount.min).toBe(10);
    expect(stats.amount.max).toBe(30);
    expect(stats.amount.avg).toBe(20);
    expect(stats.amount.sum).toBe(60);
    expect(stats.amount.distinct_count).toBe(3);
    expect(stats.amount.null_count).toBe(1);
  });

  it("counts distinct and null per string column", () => {
    const stats = computeColumnStats(rows, defs);
    expect(stats.category.distinct_count).toBe(2);
    expect(stats.category.null_count).toBe(1);
    expect(stats.category.min).toBeNull();
    expect(stats.category.sum).toBeNull();
  });

  it("does not compute numeric aggregates for date columns", () => {
    const stats = computeColumnStats(rows, defs);
    expect(stats.created.min).toBeNull();
    expect(stats.created.sum).toBeNull();
    expect(stats.created.distinct_count).toBe(3);
    expect(stats.created.null_count).toBe(1);
  });

  it("toStatsRows maps to the stats table shape", () => {
    const stats = computeColumnStats(rows, defs);
    const out = toStatsRows("ds-1", stats);
    expect(out).toHaveLength(3);
    const numeric = out.find((r) => r.column_key === "amount");
    expect(numeric).toMatchObject({ dataset_id: "ds-1", sum: 60, avg: 20 });
  });
});