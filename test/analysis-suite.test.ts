import { describe, expect, it } from "vitest";
import { buildSuite } from "@/lib/analysis/modules";
import type { ColumnDef } from "@/lib/types";
import { salesColumnDefs, salesRows, inventoryRows, inventoryColumnDefs } from "@/test/fixtures/pharmacy";

describe("buildSuite (pharmacy analytics orchestrator)", () => {
  it("projects a sales dataset and resolves every role", () => {
    const suite = buildSuite(salesColumnDefs, salesRows);
    expect(suite.kind).toBeNull();
    expect(suite.rows).toBe(14);
    expect(suite.roleMap.date).toBe("date");
    expect(suite.roleMap.transaction_id).toBe("transaction_id");
    expect(suite.roleMap.product).toBe("product");
    expect(suite.roleMap.qty).toBe("qty");
    expect(suite.roleMap.patient).toBe("patient");
    expect(suite.roleMap.branch).toBe("branch");
  });

  it("runs all five sales modules and returns the expected module availability", () => {
    const suite = buildSuite(salesColumnDefs, salesRows);
    expect(suite.modules.rfm.available).toBe(true);
    expect(suite.modules.basket.available).toBe(true);
    expect(suite.modules.abcXyz.available).toBe(true);
    expect(suite.modules.safetyStock.available).toBe(true);
    expect(suite.modules.forecast.available).toBe(true);
    expect(suite.modules.benchmark.available).toBe(true);
  });

  it("reports unavailable modules when required columns are absent", () => {
    const onlyProducts = salesRows.map((r) => ({ product: r.product, qty: r.qty }));
    const defs: ColumnDef[] = [
      { key: "product", label: "Product", type: "string", role: "product" },
      { key: "qty", label: "Qty", type: "numeric", role: "qty" },
    ];
    const suite = buildSuite(defs, onlyProducts);
    expect(suite.modules.rfm.available).toBe(false);
    expect(suite.modules.basket.available).toBe(false);
    expect(suite.modules.forecast.available).toBe(false);
  });

  it("computes the correct aggregate revenue across the fixture", () => {
    const suite = buildSuite(salesColumnDefs, salesRows);
    if (!suite.modules.benchmark.available) throw new Error("benchmark unavailable");
    const daily = suite.modules.benchmark.result.daily;
    expect(daily.length).toBeGreaterThanOrEqual(6); // ≥ 4 days × 2 branches
    const totalRevenue = daily.reduce((a, d) => a + d.revenue, 0);
    expect(totalRevenue).toBeCloseTo(200);
    const totalUnits = daily.reduce((a, d) => a + d.units, 0);
    expect(totalUnits).toBeCloseTo(19);
    expect(daily[0].day).toBe("2026-07-01");
  });

  it("builds a deterministic suite (same input → same JSON)", () => {
    const strip = (s: ReturnType<typeof buildSuite>) => JSON.stringify({ ...s, generatedAt: "" });
    const a = buildSuite(salesColumnDefs, salesRows);
    const b = buildSuite(salesColumnDefs, salesRows);
    expect(strip(a)).toBe(strip(b));
  });

  it("handles an inventory dataset (expiry + stock projection)", () => {
    const suite = buildSuite(inventoryColumnDefs, inventoryRows, { kind: "inventory" });
    expect(suite.kind).toBe("inventory");
    // no date column → sales modules unavailable
    expect(suite.modules.rfm.available).toBe(false);
    expect(suite.modules.expiry.available).toBe(true);
    if (suite.modules.expiry.available) {
      expect(suite.modules.expiry.result.items).toHaveLength(4);
    }
  });
});
