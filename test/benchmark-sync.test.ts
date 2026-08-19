import { describe, expect, it } from "vitest";
import {
  coerceNumeric,
  categoryMargins,
  buildBenchmarkPayload,
} from "@/lib/benchmark-sync";
import { dailyRollups, categoryRollups } from "@/lib/analysis/benchmark";

describe("benchmark-sync payload builder", () => {
  it("coerceNumeric strips currency symbols from strings", () => {
    expect(coerceNumeric("$1,234.50")).toBeCloseTo(1234.5);
    expect(coerceNumeric("EGP 45")).toBeCloseTo(45);
    expect(coerceNumeric(12)).toBe(12);
    expect(coerceNumeric("n/a")).toBe(0);
    expect(coerceNumeric(NaN)).toBe(0);
  });

  it("categoryMargins computes gross margin % when cost is present", () => {
    const margins = categoryMargins(
      [
        { category: "Analgesic", amount: 100, cost: 40 },
        { category: "Analgesic", amount: 50, cost: 20 },
        { category: "Vitamins", amount: 80, cost: 40 },
      ],
      true,
    );
    expect(margins.get("Analgesic")).toBe(60);
    expect(margins.get("Vitamins")).toBe(50);
  });

  it("categoryMargins is NULL without a cost column or on zero revenue", () => {
    const noCost = categoryMargins([{ category: "Analgesic", amount: 100 }], false);
    expect(noCost.get("Analgesic")).toBeNull();
    const zeroRev = categoryMargins([{ category: "OTC", amount: 0, cost: 10 }], true);
    expect(zeroRev.get("OTC")).toBeNull();
  });

  it("buildBenchmarkPayload preserves rollups and fills margin_pct", () => {
    const rows = [
      {
        branch: "Main",
        date: "2026-07-01",
        amount: 60,
        units: 3,
        txn: "T1",
        product: "Amoxil",
        category: "Antibiotics",
      },
    ];
    const daily = dailyRollups(rows);
    const categories = categoryRollups(rows);
    const payload = buildBenchmarkPayload({
      daily,
      categories,
      margins: new Map([["Antibiotics", 55]]),
      computedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(payload.days[0].revenue).toBeCloseTo(60);
    expect(payload.categories[0].margin_pct).toBe(55);
    expect(payload.categories[0].revenue).toBeCloseTo(60);
    expect(payload.computed_at).toBe("2026-07-01T00:00:00.000Z");
    expect(payload.categories[0]).toHaveProperty("share_pct");
  });
});