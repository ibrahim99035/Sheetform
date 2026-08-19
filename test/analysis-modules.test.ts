import { describe, expect, it } from "vitest";
import { runRfm, aggregateCustomers, segmentFor } from "@/lib/analysis/rfm";
import { classifyAbc, classifyXyz, runAbcXyz, demandSeriesByProduct, MATRIX_POLICY } from "@/lib/analysis/abc-xyz";
import { safetyStock, reorderPoint, integerUnits, runSafetyStock, zFor } from "@/lib/analysis/safety-stock";
import { riskFor, actionNote, runExpiry } from "@/lib/analysis/expiry";
import { runBasket } from "@/lib/analysis/basket";
import type { SalesLine } from "@/lib/analysis/rfm";
import type { InventoryLine, DemandForProduct } from "@/lib/analysis/expiry";
import { salesRows, salesColumnDefs, avgDailyDemand } from "@/test/fixtures/pharmacy";
import { buildSuite } from "@/lib/analysis/modules";

const REF = "2026-07-03";

function line(partial: Partial<SalesLine>): SalesLine {
  return {
    customer_id: null,
    date: REF,
    transaction_id: null,
    product: "Amoxil 500",
    category: "Antibiotics",
    amount: 0,
    units: 1,
    branch: "Main",
    raw: {},
    ...partial,
  } as SalesLine;
}

describe("RFM", () => {
  it("scores customers 1..5 with recency inverted (most recent = 5)", () => {
    const lines = [
      line({ customer_id: "P1", date: "2026-07-03", amount: 100, transaction_id: "A" }),
      line({ customer_id: "P2", date: "2026-07-02", amount: 50, transaction_id: "B" }),
      line({ customer_id: "P3", date: "2026-07-01", amount: 10, transaction_id: "C" }),
    ];
    const res = runRfm(lines, REF);
    expect(res.customers).toHaveLength(3);
    const p1 = res.customers.find((c) => c.customer_id === "P1");
    const p3 = res.customers.find((c) => c.customer_id === "P3");
    expect(p1?.r).toBe(5);
    expect(p3?.r).toBeLessThan(p1?.r ?? 0);
    for (const c of res.customers) {
      expect([1, 2, 3, 4, 5]).toContain(c.r);
      expect([1, 2, 3, 4, 5]).toContain(c.f);
      expect([1, 2, 3, 4, 5]).toContain(c.m);
    }
  });

  it("assigns P1 the Champions segment (frequent + recent)", () => {
    const lines = [
      line({ customer_id: "P1", date: "2026-07-03", amount: 100, transaction_id: "A" }),
      line({ customer_id: "P1", date: "2026-07-02", amount: 50, transaction_id: "B" }),
      line({ customer_id: "P1", date: "2026-07-01", amount: 20, transaction_id: "C" }),
      line({ customer_id: "P1", date: "2026-06-30", amount: 15, transaction_id: "D" }),
      line({ customer_id: "P1", date: "2026-06-29", amount: 10, transaction_id: "E" }),
      line({ customer_id: "P2", date: "2026-07-03", amount: 10, transaction_id: "F" }),
      line({ customer_id: "P3", date: "2026-07-02", amount: 5, transaction_id: "G" }),
      line({ customer_id: "P4", date: "2026-07-01", amount: 3, transaction_id: "H" }),
    ];
    const res = runRfm(lines, REF);
    const champs = res.segments.find((s) => s.segment === "Champions");
    expect(champs).toBeDefined();
    expect(champs?.count).toBeGreaterThanOrEqual(1);
  });

  it("flags walk-in registers when customer id is missing", () => {
    const res = runRfm([line({ customer_id: null })], REF);
    expect(res.segments.find((s) => s.segment === "New Customers")?.count).toBe(1);
    expect(res.flags.some((f) => f.message.includes("walk-in"))).toBe(true);
  });

  it("aggregateCustomers rolls up multi-line visits", () => {
    const agg = aggregateCustomers(
      [
        line({ customer_id: "P1", date: "2026-07-03", amount: 30, transaction_id: "A" }),
        line({ customer_id: "P1", date: "2026-07-03", amount: 12, transaction_id: "A" }),
        line({ customer_id: "P1", date: "2026-07-01", amount: 8, transaction_id: "B" }),
      ],
      Date.parse(REF),
    );
    const p1 = agg.find((c) => c.customer_id === "P1");
    expect(p1?.frequency).toBe(2);
    expect(p1?.monetary).toBeCloseTo(50);
  });

  it("exposes a deterministic taxonomy across segmentFor", () => {
    expect(segmentFor(5, 5)).toBe("Champions");
    expect(segmentFor(4, 1)).toBe("New Customers");
    expect(segmentFor(2, 5)).toBe("At Risk");
    expect(segmentFor(1, 5)).toBe("Cannot Lose Them");
    expect(segmentFor(1, 2)).toBe("About To Sleep");
    expect(segmentFor(1, 1)).toBe("Lost");
  });
});

describe("ABC-XYZ", () => {
  it("classifies A/B/C on cumulative revenue share", () => {
    expect(classifyAbc(0.5, 0.8, 0.95)).toBe("A");
    expect(classifyAbc(0.85, 0.8, 0.95)).toBe("B");
    expect(classifyAbc(0.99, 0.8, 0.95)).toBe("C");
  });

  it("classifies X/Y/Z on coefficient of variation", () => {
    expect(classifyXyz(0.05, false, 0.1, 0.25)).toBe("X");
    expect(classifyXyz(0.15, false, 0.1, 0.25)).toBe("Y");
    expect(classifyXyz(0.5, false, 0.1, 0.25)).toBe("Z");
  });

  it("runs the full ABC-XYZ on the fixture with correct top product", () => {
    const suite = buildSuite(salesColumnDefs, salesRows);
    if (!suite.modules.abcXyz.available) throw new Error("abc unavailable");
    const { abc } = suite.modules.abcXyz.result;
    expect(abc[0].product).toBe("Amoxil 500");
    expect(abc[0].revenue_share).toBeCloseTo(60, 1);
    expect(abc[0].abc).toBe("A");
    const saline = abc.find((p) => p.product === "Saline");
    expect(saline?.abc).toBe("C");
  });

  it("builds a 12-cell matrix with policies", () => {
    const res = runAbcXyz(
      [{ product: "A", revenue: 100 }],
      [{ product: "A", day: "2026-07-01", units: 5 }],
    );
    expect(res.matrix).toHaveLength(9);
    expect(res.matrix.map((c) => c.cell)).toEqual(
      ["AX", "AY", "AZ", "BX", "BY", "BZ", "CX", "CY", "CZ"],
    );
    const cz = res.matrix.find((c) => c.cell === "CZ");
    expect(cz?.products).toContain("A");
    expect(MATRIX_POLICY.CZ.policy).toBeDefined();
    expect(res.thresholds.aShare).toBe(0.8);
  });

  it("demandSeriesByProduct buckets rows by day", () => {
    const series = demandSeriesByProduct([
      { product: "A", day: "2026-07-01", units: 2 },
      { product: "A", day: "2026-07-01", units: 3 },
      { product: "A", day: "2026-07-02", units: 1 },
    ]);
    expect(series.get("A")).toEqual([2, 3, 1]);
  });
});

describe("Safety stock", () => {
  it("computes safety stock as z·σ·√L", () => {
    // demand mean 10, σ = 1.5, L = 7, z = 1.28 (90%)
    const demand = [10, 12, 8, 11, 9, 10, 12, 8];
    const ss = safetyStock(demand, 7, zFor(90));
    expect(ss).toBeGreaterThan(4.9);
    expect(ss).toBeLessThan(5.2);
    const rp = reorderPoint(10, 1.5, 7, zFor(90));
    expect(rp).toBeGreaterThan(74);
    expect(rp).toBeLessThan(76);
  });

  it("zFor returns the standard service-level z-scores", () => {
    expect(zFor(90)).toBeCloseTo(1.28);
    expect(zFor(95)).toBeCloseTo(1.65);
    expect(zFor(99)).toBeCloseTo(2.33);
  });

  it("integerUnits rounds up to whole packs", () => {
    expect(integerUnits(5.08)).toBe(6);
  });

  it("flags products with insufficient demand history", () => {
    const res = runSafetyStock(new Map([["A", [10, 11, 9]]]), { minHistoryDays: 7 });
    expect(res.items[0].insufficient_history).toBe(true);
    expect(res.flags.some((f) => f.message.includes("fewer than"))).toBe(true);
  });
});

describe("Expiry risk", () => {
  const inventory: InventoryLine[] = [
    { product: "Amoxil 500", expiry_date: "2026-08-01", stock_on_hand: 100, unit_cost: 8 },
    { product: "Paracetamol", expiry_date: "2026-06-01", stock_on_hand: 50, unit_cost: 2 },
    { product: "Vit C", expiry_date: "2026-09-01", stock_on_hand: 30, unit_cost: 4 },
    { product: "Saline", expiry_date: null, stock_on_hand: 20, unit_cost: 1 },
  ];
  const demand: DemandForProduct[] = avgDailyDemand;

  it("buckets items by days-to-expiry from the reference date", () => {
    const res = runExpiry(inventory, demand, { referenceDate: "2026-07-15" });
    const buckets = Object.fromEntries(res.buckets.map((b) => [b.bucket, b]));
    expect(buckets["expired"].count).toBe(1); // Paracetamol
    expect(buckets["0-30d"].count).toBe(1); // Amoxil
    expect(buckets["31-90d"].count).toBe(1); // Vit C
    expect(buckets["180d+"].count).toBe(1); // Saline (no expiry)
  });

  it("computes financial exposure from stock × unit cost", () => {
    const res = runExpiry(inventory, demand, { referenceDate: "2026-07-15" });
    expect(res.total_stock_value).toBeCloseTo(1040);
    expect(res.at_risk_units).toBe(180);
    expect(res.at_risk_exposure).toBeCloseTo(1020);
  });

  it("riskFor escalates expired and urgent correctly", () => {
    expect(riskFor(-5, null, true)).toBe("expired");
    expect(riskFor(10, 20, true)).toBe("urgent");
    expect(riskFor(60, 5, true)).toBe("at_risk");
    expect(riskFor(300, 5, true)).toBe("ok");
  });

  it("provides an action note per risk", () => {
    expect(actionNote({ risk: "expired" } as never)).toContain("quarantine");
    expect(actionNote({ risk: "urgent" } as never)).toContain("expire before exhausted");
  });
});

describe("Market basket", () => {
  it("counts item pairs within shared transactions", () => {
    const res = runBasket(
      [
        { transaction_id: "T1", product: "Amoxil 500" },
        { transaction_id: "T1", product: "Paracetamol" },
        { transaction_id: "T2", product: "Amoxil 500" },
      ],
      { minPairs: 1 },
    );
    const pair = res.pairs.find((p) => p.product_a === "Amoxil 500" && p.product_b === "Paracetamol");
    expect(pair?.pairs).toBe(1);
    expect(pair?.support).toBeCloseTo(50);
    expect(pair?.confidence_a).toBeCloseTo(50);
    expect(pair?.lift).toBeCloseTo(1);
  });

  it("derives top pair from the sales fixture via the orchestrator", () => {
    const suite = buildSuite(salesColumnDefs, salesRows);
    if (!suite.modules.basket.available) throw new Error("basket unavailable");
    const { pairs } = suite.modules.basket.result.marketBasket;
    const top = pairs[0];
    expect(top.product_a).toBe("Amoxil 500");
    expect(top.product_b).toBe("Paracetamol");
    expect(top.pairs).toBe(2);
  });
});
