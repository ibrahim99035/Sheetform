import { describe, expect, it } from "vitest";
import {
  smaForecast,
  naiveForecast,
  mape,
  holtWinters,
  toDailySeries,
  dailyDatesFrom,
  runForecast,
  type ForecastPoint,
} from "@/lib/analysis/forecast";
import { salesColumnDefs, salesRows } from "@/test/fixtures/pharmacy";
import { buildSuite } from "@/lib/analysis/modules";

describe("forecast primitives", () => {
  it("smaForecast averages the trailing window", () => {
    const flat = [10, 10, 10, 10, 10, 10, 10];
    expect(smaForecast(flat, 7, 3)).toEqual([10, 10, 10]);
    const step = [10, 12, 14, 16];
    const f = smaForecast(step, 2, 2);
    expect(f[0]).toBeCloseTo(15);
    expect(f[1]).toBeCloseTo(15.5);
  });

  it("naiveForecast persists the last observation", () => {
    expect(naiveForecast([3, 5, 9], 4)).toEqual([9, 9, 9, 9]);
    expect(naiveForecast([], 2)).toEqual([0, 0]);
  });

  it("mape reports symmetric percent error", () => {
    expect(mape([10, 20], [10, 20])).toBe(0);
    expect(mape([10, 20], [11, 16])).toBeCloseTo(15);
    expect(mape([0, 0], [5, 5])).toBeNull();
    expect(mape([10, 0], [10, 5])).toBe(0);
  });

  it("holtWinters falls back to SMA when series is too short", () => {
    const { forecast } = holtWinters([5, 5, 5], 7, 3, 0.4, 0.2, 0.3);
    expect(forecast).toEqual([5, 5, 5]);
  });

  it("holtWinters returns one forecast per horizon step", () => {
    const series = Array.from({ length: 30 }, (_, i) => 10 + Math.sin(i / 3) * 2);
    const { fitted, forecast } = holtWinters(series, 7, 7, 0.4, 0.2, 0.3);
    expect(fitted.length).toBe(30);
    expect(forecast.length).toBe(7);
    for (const v of forecast) expect(Number.isFinite(v)).toBe(true);
  });

  it("toDailySeries sums multiple points per day and sorts", () => {
    const pts: ForecastPoint[] = [
      { date: "2026-07-02", value: 3 },
      { date: "2026-07-01", value: 1 },
      { date: "2026-07-01", value: 2 },
    ];
    const series = toDailySeries(pts);
    expect(series).toEqual([3, 3]);
    expect(series.length).toBe(2);
  });

  it("dailyDatesFrom continues the sequence past the last day", () => {
    const dates = dailyDatesFrom([0, 0, 0], "2026-07-01");
    expect(dates[0]).toBe("2026-07-01");
    expect(dates.length).toBe(3);
    expect(dates[2]).toBe("2026-07-03");
  });
});

describe("runForecast", () => {
  it("forecasts a flat weekly series near its level", () => {
    const points = Array.from({ length: 28 }, (_, i) => ({
      date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
      value: 10,
    }));
    const res = runForecast(points, { horizon: 7 });
    expect(res.history.length).toBe(28);
    expect(res.forecast.length).toBe(7);
    for (const f of res.forecast) expect(f.value).toBeCloseTo(10, 0);
  });

  it("produces a deterministic result (grid search is stable)", () => {
    const points = Array.from({ length: 21 }, (_, i) => ({
      date: `2026-07-${String((i % 21) + 1).padStart(2, "0")}`,
      value: 5 + (i % 3),
    }));
    const a = runForecast(points, { horizon: 7 });
    const b = runForecast(points, { horizon: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(["sma", "holt-winters", "naive"]).toContain(a.method);
  });

  it("flags too-little history", () => {
    const res = runForecast([{ date: "2026-07-01", value: 1 }, { date: "2026-07-02", value: 2 }]);
    expect(res.flags.some((f) => f.level === "high")).toBe(true);
  });

  it("runs end-to-end through the orchestrator on the sales fixture", () => {
    const suite = buildSuite(salesColumnDefs, salesRows);
    if (!suite.modules.forecast.available) throw new Error("forecast unavailable");
    const fc = suite.modules.forecast.result.forecast;
    expect(fc.history.length).toBe(4);
    expect(fc.forecast.length).toBe(14);
    for (const f of fc.forecast) expect(Number.isFinite(f.value)).toBe(true);
  });
});
