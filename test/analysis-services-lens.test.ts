import { describe, expect, it } from "vitest";
import { runSalesLens } from "@/lib/analysis/sales";
import { runSupplierLens } from "@/lib/analysis/supplier";
import { runGeography } from "@/lib/analysis/geography";
import { runBudget } from "@/lib/analysis/budget";
import { runStocktake } from "@/lib/analysis/stocktake";
import { buildSuite } from "@/lib/analysis/modules";
import { assessServiceCoverage } from "@/lib/analysis/services";
import type { ColumnDef } from "@/lib/types";

describe("sales lens (تحليل البيع)", () => {
  const lines = [
    { date: "2026-07-01", product: "Amoxil", category: "Antibiotics", amount: 40, units: 2, transaction_id: "T1", refunded: false, rep: "R1", team: "A" },
    { date: "2026-07-01", product: "Paracetamol", category: "Analgesics", amount: 6, units: 1, transaction_id: "T1", refunded: false, rep: "R1", team: "A" },
    { date: "2026-07-02", product: "Amoxil", category: "Antibiotics", amount: 20, units: 1, transaction_id: "T2", refunded: true, rep: "R2", team: "A" },
    { date: "2026-07-03", product: "Saline", category: "Medical", amount: 8, units: 2, transaction_id: "T3", refunded: false, rep: "R2", team: "B" },
  ];

  it("totals net revenue, units and distinct transactions", () => {
    const r = runSalesLens(lines);
    expect(r.totals.revenue).toBe(54); // 40+6+8 (refund line excluded)
    expect(r.totals.units).toBe(5);
    expect(r.totals.transactions).toBe(3);
    expect(r.totals.avg_ticket).toBe(18);
    expect(r.totals.refund_pct).toBeCloseTo(27.03, 1);
  });

  it("ranks categories and products by gross value and is deterministic", () => {
    const a = runSalesLens(lines);
    const b = runSalesLens(lines);
    expect(a.categories[0].label).toBe("Antibiotics");
    expect(a.categories[0].value).toBe(60);
    expect(a.products[0].label).toBe("Amoxil");
    expect(a.monthly[0].period).toBe("2026-07");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("splits performance by rep and team when present", () => {
    const r = runSalesLens(lines);
    expect(r.byRep).not.toBeNull();
    expect(r.byTeam).not.toBeNull();
    expect(r.byRep?.[0].label).toBe("R1");
    expect(r.byTeam?.[0].label).toBe("A");
  });
});

describe("supplier lens (تحليل الموردين)", () => {
  const purchases = [
    { supplier: "Pharco", date: "2026-01-05", order: "PO1", product: "Amoxil", qty: 100, cost: 300, unit_cost: 3 },
    { supplier: "Pharco", date: "2026-02-03", order: "PO2", product: "Amoxil", qty: 50, cost: 150, unit_cost: 3 },
    { supplier: "Novo", date: "2026-01-10", order: "PO3", product: "Ozempic", qty: 10, cost: 500, unit_cost: 50 },
    { supplier: "GSK", date: "2026-03-01", order: "PO4", product: "Augmentin", qty: 20, cost: 200, unit_cost: 10 },
  ];

  it("aggregates spend by supplier with share and concentration", () => {
    const r = runSupplierLens(purchases);
    expect(r.totals.spend).toBe(1150);
    expect(r.totals.orders).toBe(4);
    expect(r.suppliers).toHaveLength(3);
    expect(r.suppliers[0].label).toBe("Novo");
    expect(r.suppliers[0].share_pct).toBeCloseTo(43.48, 1);
    expect(r.concentration.top3_share_pct).toBe(100);
    expect(r.monthly.find((m) => m.period === "2026-01")?.orders).toBe(2);
  });

  it("handles an empty purchases sheet gracefully", () => {
    const r = runSupplierLens([]);
    expect(r.totals.spend).toBe(0);
    expect(r.suppliers).toHaveLength(0);
    expect(r.flags.some((f) => f.level === "high")).toBe(true);
  });
});

describe("geography lens (تحليل جغرافي)", () => {
  const geo = [
    { city: "Cairo", region: "Cairo", country: "Egypt", lat: 30.0, lng: 31.2, customer: "P1", amount: 100, units: 5 },
    { city: "Cairo", region: "Cairo", country: "Egypt", lat: 30.0, lng: 31.2, customer: "P1", amount: 50, units: 2, },
    { city: "Alex", region: "Alex", country: "Egypt", lat: 31.2, lng: 29.9, customer: "P2", amount: 30, units: 1 },
  ];

  it("buckets sales by city/region/country and builds map markers", () => {
    const r = runGeography(geo);
    expect(r.totals.revenue).toBe(180);
    expect(r.totals.customers).toBe(2);
    expect(r.cities[0].label).toBe("Cairo");
    expect(r.cities[0].share_pct).toBeCloseTo(83.33, 1);
    expect(r.regions[0].label).toBe("Cairo");
    expect(r.countries[0].label).toBe("Egypt");
    expect(r.markers).toHaveLength(2);
    expect(r.markers[0].label).toBe("Cairo");
  });

  it("activates with only a country column (OR-gated) and flags missing coordinates", () => {
    const r = runGeography([{ city: null, region: null, country: "Egypt", lat: null, lng: null, customer: null, amount: 10, units: 1 }]);
    expect(r.countries[0].label).toBe("Egypt");
    expect(r.markers).toHaveLength(0);
    expect(r.flags.some((f) => /No latitude\/longitude/.test(f.message))).toBe(true);
  });
});

describe("budget lens (الموازنات المالية)", () => {
  it("reports variance and attainment per period/category and in total", () => {
    const r = runBudget([
      { period: "2026-07", category: "Antibiotics", branch: null, budget: 100, actual: 120, units: 0 },
      { period: "2026-07", category: "Analgesics", branch: null, budget: 50, actual: 30, units: 0 },
    ]);
    expect(r.rows).toHaveLength(2);
    const anti = r.rows.find((x) => x.category === "Antibiotics");
    expect(anti?.variance).toBe(20);
    expect(anti?.attainment_pct).toBe(120);
    expect(r.totals.budget).toBe(150);
    expect(r.totals.actual).toBe(150);
    expect(r.totals.variance).toBe(0);
    expect(r.totals.attainment_pct).toBe(100);
  });

  it("collapses duplicate rows into one merged line", () => {
    const r = runBudget([
      { period: "2026-07", category: null, branch: null, budget: 10, actual: 5, units: 0 },
      { period: "2026-07", category: null, branch: null, budget: 15, actual: 20, units: 0 },
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].budget).toBe(25);
    expect(r.rows[0].actual).toBe(25);
  });
});

describe("stocktake lens (الجرد الفعلي)", () => {
  it("computes counted-vs-system variance and adjustment value", () => {
    const r = runStocktake(
      [
        { product: "Amoxil", batch: null, counted_qty: 95 },
        { product: "Saline", batch: null, counted_qty: 22 },
      ],
      [
        { product: "Amoxil", batch: null, system_qty: 100, unit_cost: 5 },
        { product: "Saline", batch: null, system_qty: 20, unit_cost: 1 },
      ],
    );
    expect(r.totals.variance_units).toBe(-3);
    expect(r.totals.mismatch_lines).toBe(2);
    expect(r.totals.variance_value).toBe(-23);
    const amoxil = r.rows.find((x) => x.product === "Amoxil");
    expect(amoxil?.variance).toBe(-5);
    expect(amoxil?.variance_pct).toBe(-5);
    expect(amoxil?.adjustment_value).toBe(-25);
  });

  it("treats un-matched system stock as full variance and flags shrinkage", () => {
    const r = runStocktake([{ product: "Unknown", batch: null, counted_qty: 0 }], [{ product: "Unknown", batch: null, system_qty: 10, unit_cost: 5 }]);
    expect(r.rows[0].system_qty).toBe(10);
    expect(r.rows[0].variance).toBe(-10);
    expect(r.totals.variance_value).toBe(-50);
    expect(r.flags.some((f) => /shrinkage/.test(f.message))).toBe(true);
  });
});

describe("orchestrator integration", () => {
  const defs = (...extra: ColumnDef[]): ColumnDef[] => [
    { key: "supplier", label: "Supplier", type: "string", role: "supplier", role_confidence: "high" },
    { key: "purchase_date", label: "Purchase date", type: "date", role: "purchase_date", role_confidence: "high" },
    { key: "purchase_qty", label: "Qty", type: "numeric", role: "purchase_qty", role_confidence: "high" },
    { key: "purchase_cost", label: "Unit cost", type: "numeric", role: "purchase_cost", role_confidence: "high" },
    ...extra,
  ];

  const rows = [
    { supplier: "Pharco", purchase_date: "2026-01-05", purchase_qty: 100, purchase_cost: 3 },
    { supplier: "Novo", purchase_date: "2026-01-10", purchase_qty: 10, purchase_cost: 50 },
  ];

  it("runs the five new lens modules from a purchases dataset", () => {
    const suite = buildSuite(defs(), rows);
    expect(suite.modules.supplier.available).toBe(true);
    expect(suite.modules.sales.available).toBe(false); // no qty/revenue/unit_price sales signal
    expect(suite.modules.geography.available).toBe(false);
    expect(suite.modules.budget.available).toBe(false);
    expect(suite.modules.stocktake.available).toBe(false);
    if (suite.modules.supplier.available) {
      expect(suite.modules.supplier.result.suppliers.totals.spend).toBe(800);
    }
  });

  it("marks the suppliers service available for a purchases dataset role map", () => {
    const suite = buildSuite(defs({ key: "product", label: "Product", type: "string", role: "product", role_confidence: "high" }), rows.map((r) => ({ ...r, product: "Item" })));
    const coverage = assessServiceCoverage(suite.roleMap);
    expect(coverage.find((c) => c.id === "suppliers")?.available).toBe(true);
    expect(coverage.find((c) => c.id === "sales")?.available).toBe(false);
  });

  it("exposes stocktake + budget when count/budget columns are present", () => {
    const countSuite = buildSuite(
      defs({ key: "counted_qty", label: "Counted", type: "numeric", role: "counted_qty", role_confidence: "high" }),
      [{ supplier: "", purchase_date: "2026-01-05", purchase_qty: 0, purchase_cost: 0, counted_qty: 95 }],
    );
    expect(countSuite.modules.stocktake.available).toBe(true);

    const budgetSuite = buildSuite(
      defs({ key: "budget", label: "Budget", type: "numeric", role: "budget", role_confidence: "high" }),
      [{ supplier: "", purchase_date: "2026-01-05", purchase_qty: 0, purchase_cost: 0, budget: 1000 }],
    );
    expect(budgetSuite.modules.budget.available).toBe(true);
  });
});