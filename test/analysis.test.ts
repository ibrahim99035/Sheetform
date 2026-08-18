import { describe, expect, it } from "vitest";
import { runAnalysis } from "@/lib/analysis";
import { salesPayload, messyPayload } from "@/test/fixtures/analysis";

describe("runAnalysis (engine)", () => {
  it("produces a report with all spec sections", () => {
    const report = runAnalysis(salesPayload(), "ds-1", "Jan Sales");
    const sections = [
      "## Column Mapping",
      "## Data Quality Summary",
      "## Computed Metrics",
      "## Key Insights & Recommended Actions",
      "## Limitations & Assumptions",
      "## Suggested Follow-up Questions",
    ];
    for (const s of sections) {
      expect(report.markdown).toContain(s);
    }
  });

  it("computes core KPIs with confidence tags", () => {
    const report = runAnalysis(salesPayload(), "ds-1", "Jan Sales");
    const revenue = report.metrics.find((m) => m.key === "revenue");
    expect(revenue?.value).toBeCloseTo(42);
    expect(revenue?.confidence).toBe("medium");

    const units = report.metrics.find((m) => m.key === "units");
    expect(units?.value).toBeCloseTo(8);

    const marginPct = report.metrics.find((m) => m.key === "gross_margin_pct");
    expect(marginPct?.value).toBeCloseTo(70.24);

    const period = report.metrics.find((m) => m.key === "period_change");
    expect(period?.value).toBeCloseTo(-60);
    expect(period?.confidence).toBe("medium");
  });

  it("generates deterministic insights from the data", () => {
    const report = runAnalysis(salesPayload(), "ds-1", "Jan Sales");
    expect(report.insights.length).toBeGreaterThan(0);
    const periodDelta = report.insights.find((i) => i.id === "period_delta");
    expect(periodDelta).toBeDefined();
    expect(periodDelta?.title).toContain("decreased");
    expect(periodDelta?.body).toContain("12");
    expect(["high", "medium", "low"]).toContain(periodDelta?.confidence);
  });

  it("flags missing dates and low confidence in a messy dataset", () => {
    const report = runAnalysis(messyPayload(), "ds-2", "Messy");
    const dateFlag = report.dataQuality.flags.some((f) => f.message.includes("Date"));
    expect(dateFlag).toBe(true);
    // no period comparison because date is ~all missing → timeSeries empty
    expect(report.timeSeries.length).toBe(0);
    expect(report.comparisonLabel).toBeNull();
    expect(report.metrics.find((m) => m.key === "gross_margin")?.value).toBeNull();
    // limitations mention missing cost
    expect(report.limitations.join(" ")).toContain("cost");
  });

  it("assigns High/Medium/Low confidence derived from sample size", () => {
    const tiny = salesPayload();
    tiny.rows = 3;
    tiny.kpis = { ...tiny.kpis, rows: 3 };
    tiny.quality = { ...tiny.quality, rows: 3 };
    const tinyReport = runAnalysis(tiny, "ds-3", "Tiny");
    expect(tinyReport.metrics.find((m) => m.key === "revenue")?.confidence).toBe("low");
    expect(tinyReport.limitations.join(" ")).toContain("small");

    const large = salesPayload();
    large.rows = 2000;
    large.kpis = { ...large.kpis, rows: 2000 };
    large.quality = { ...large.quality, rows: 2000 };
    const largeReport = runAnalysis(large, "ds-3b", "Large");
    expect(largeReport.metrics.find((m) => m.key === "revenue")?.confidence).toBe("high");
    expect(largeReport.limitations.some((l) => l.includes("sample size"))).toBe(false);
  });

  it("markdown escapes pipes in labels", () => {
    const p = salesPayload();
    p.quality.columns = p.quality.columns.map((c) =>
      c.role === "product" ? { ...c, label: "Prod | X" } : c,
    );
    p.columns = p.columns.map((c) =>
      c.key === "product" ? { ...c, label: "Prod | X" } : c,
    );
    const report = runAnalysis(p, "ds-4", "Pipes");
    expect(report.markdown).toContain("Prod \\| X");
  });
});