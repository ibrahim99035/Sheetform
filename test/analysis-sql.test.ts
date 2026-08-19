import { describe, expect, it } from "vitest";
import {
  abcRevenueSql,
  dailyDemandSql,
  rfmAggregateSql,
  basketPairsSql,
  forecastSeriesSql,
  benchmarkDailySql,
  categoryBenchmarkSql,
  expiryInventorySql,
} from "@/lib/analysis/sql";

describe("duckdb sql builders", () => {
  it("abcRevenueSql computes cumulative share and ABC class", () => {
    const q = abcRevenueSql("sales", "product", "amount");
    expect(q.label).toBe("abc-revenue");
    expect(q.sql).toContain('"product"');
    expect(q.sql).toContain('"amount"');
    expect(q.sql).toContain("cumulative_share");
    expect(q.sql).toContain("<= 0.80");
    expect(q.sql).toContain("GROUP BY");
  });

  it("dailyDemandSql buckets by product and day", () => {
    const q = dailyDemandSql("sales", "product", "date", "qty");
    expect(q.sql).toContain("GROUP BY");
    expect(q.sql).toContain('"date"');
    expect(q.sql).toContain("AS DATE");
  });

  it("rfmAggregateSql groups by customer and counts txns", () => {
    const q = rfmAggregateSql("sales", "patient", "date", "amount", "transaction_id");
    expect(q.sql).toContain('"patient"');
    expect(q.sql).toContain("COUNT(DISTINCT");
    expect(q.sql).toContain("GROUP BY");
    // no amount key → frequency defaults to COUNT(*)
    const q2 = rfmAggregateSql("sales", "patient", "date", null, null);
    expect(q2.sql).toContain("COUNT(*) * 1.0");
  });

  it("basketPairsSql self-joins transactions into ordered pairs", () => {
    const q = basketPairsSql("sales", "transaction_id", "product");
    expect(q.sql).toContain("a.product < b.product");
    expect(q.sql).toContain("support");
    expect(q.sql).toContain("lift");
    expect(q.sql).toContain("LIMIT 20");
  });

  it("forecastSeriesSql buckets to a daily series", () => {
    const q = forecastSeriesSql("sales", "date", "amount");
    expect(q.sql).toContain("AS date");
    expect(q.sql).toContain("GROUP BY");
  });

  it("benchmarkDailySql handles missing optional columns", () => {
    const q = benchmarkDailySql("sales", "date", null, null, null, null, null);
    expect(q.sql).toContain("NULL::VARCHAR");
    expect(q.sql).toContain("COUNT(*)");
  });

  it("categoryBenchmarkSql computes share over the total", () => {
    const q = categoryBenchmarkSql("sales", "category", "amount", null);
    expect(q.sql).toContain('"category"');
    expect(q.sql).toContain("OVER ()");
  });

  it("expiryInventorySql projects expiry + stock", () => {
    const q = expiryInventorySql("inventory", "expiry_date", "stock_on_hand", "unit_cost", "product");
    expect(q.sql).toContain('"expiry_date"');
    expect(q.sql).toContain('"stock_on_hand"');
  });

  it("escapes injected identifier quotes", () => {
    const q = abcRevenueSql('sales"OR"1=1', 'prod"uct', "amount");
    expect(q.sql).toContain('"sales""OR""1=1"');
    expect(q.sql).toContain('"prod""uct"');
    // the raw un-quoted injection would concatenate columns; it must not appear
    expect(q.sql).not.toMatch(/sales"OR"1=1/);
  });
});
