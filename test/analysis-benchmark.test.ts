import { describe, expect, it } from "vitest";
import {
  dailyRollups,
  categoryRollups,
  compareToMarket,
  tenantDailyAverages,
} from "@/lib/analysis/benchmark";
import {
  hashPatient,
  findPatientColumn,
  benchmarkPayloadKeys,
  sanitizeRowForBenchmark,
} from "@/lib/privacy";
import { salesColumnDefs, salesRows } from "@/test/fixtures/pharmacy";

describe("benchmark rollups", () => {
  it("aggregates daily revenue/units/transactions per branch", () => {
    const rows = salesRows.map((r) => ({
      branch: r.branch as string,
      date: r.date as string,
      amount: (r.qty as number) * (r.unit_price as number),
      units: r.qty as number,
      txn: r.transaction_id as string,
      product: r.product as string,
    }));
    const daily = dailyRollups(rows);
    const totalRevenue = daily.reduce((a, d) => a + d.revenue, 0);
    expect(totalRevenue).toBeCloseTo(200);
    const main = daily.find((d) => d.branch === "Main" && d.day === "2026-07-01");
    expect(main?.revenue).toBeCloseTo(54);
    expect(daily.every((d) => d.day === d.day.slice(0, 10))).toBe(true);
  });

  it("categories sort by revenue descending with share", () => {
    const cats = categoryRollups(
      salesRows.map((r) => ({ category: r.category as string, amount: (r.qty as number) * (r.unit_price as number) })),
    );
    expect(cats[0].category).toBe("Antibiotics");
    expect(cats[0].revenue).toBeCloseTo(120);
    expect(cats[0].share_pct).toBeCloseTo(60, 0);
  });

  it("tenantDailyAverages derives mean daily metrics + ticket value", () => {
    const avgs = tenantDailyAverages(
      salesRows.map((r) => ({
        date: r.date as string,
        amount: (r.qty as number) * (r.unit_price as number),
        units: r.qty as number,
        txn: r.transaction_id as string,
      })),
    );
    expect(avgs.avg_daily_revenue).toBeGreaterThan(0);
    expect(avgs.avg_transaction_value).toBeGreaterThan(0);
  });

  it("compareToMarket computes deltas excluding zero denominators", () => {
    const cmp = compareToMarket(
      { avg_daily_revenue: 60, avg_daily_units: 8 },
      { avg_daily_revenue: 50, avg_daily_units: 0 },
    );
    const revenue = cmp.find((c) => c.metric === "avg_daily_revenue");
    expect(revenue?.delta_pct).toBeCloseTo(20);
    const units = cmp.find((c) => c.metric === "avg_daily_units");
    expect(units?.market).toBe(0);
    expect(units?.delta_pct).toBeNull();
  });
});

describe("privacy layer", () => {
  it("hashes patient ids deterministically", async () => {
    const a = await hashPatient("P1", "salt-1");
    const b = await hashPatient("P1", "salt-1");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
    const c = await hashPatient("P1", "salt-2");
    expect(c).not.toBe(a);
  });

  it("finds the patient column from stamped defs", () => {
    const info = findPatientColumn(salesColumnDefs);
    expect(info?.key).toBe("patient");
    expect(info?.confidence).toBe("high");
    expect(findPatientColumn([])).toBeNull();
  });

  it("benchmark payload keys remap patient → patient_hash", () => {
    const { keys, hashed } = benchmarkPayloadKeys(salesColumnDefs);
    expect(keys).toContain("patient_hash");
    expect(keys).not.toContain("patient");
    expect(hashed).toBe(true);
  });

  it("sanitizeRowForBenchmark drops the patient column and hashes its value", async () => {
    const out = await sanitizeRowForBenchmark(
      { product: "Amoxil 500", patient: "P1", qty: 2 },
      "patient",
      "salt",
    );
    expect(out.patient).toBeUndefined();
    expect(typeof out.patient_hash).toBe("string");
    expect(out.product).toBe("Amoxil 500");
    expect(out.patient_hash).toBe(await hashPatient("P1", "salt"));
  });
});
