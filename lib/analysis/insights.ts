import type {
  AnalysisRpcPayload,
  Insight,
  Metric,
  MetricConfidence,
  Severity,
} from "./types";
import type { DataQualitySummary } from "./quality";
import { sampleFactor } from "./quality";
import { fmtCurrency } from "../currency";

function fmtPct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${Math.abs(Math.round(n))}%`;
}

function severityFor(value: number | null, highFlags: number): Severity {
  if (Math.abs(value ?? 0) >= highFlags) return "high";
  if (Math.abs(value ?? 0) >= 3) return "medium";
  return "low";
}

function insightConfidence(confidences: number[], rows: number): MetricConfidence {
  let c = 1;
  for (const x of confidences) c = Math.min(c, x);
  const scaled = c * sampleFactor(rows);
  if (scaled >= 0.85) return "high";
  if (scaled >= 0.5) return "medium";
  return "low";
}

// Build deterministic insight templates. Every insight is phrased from numbers
// computed earlier; confidence = min(role confidences involved) × sample size.
export function generateInsights(
  payload: AnalysisRpcPayload,
  metrics: Metric[],
  dataQuality: DataQualitySummary,
  byRoleConf: Map<string, number>,
): Insight[] {
  const insights: Insight[] = [];
  const rows = payload.rows;
  const { kpis, comparison, refund, concentration } = payload;

  const roleConf = (...roles: string[]): MetricConfidence => {
    const cs = roles.map((r) => byRoleConf.get(r) ?? 0.7);
    return insightConfidence(cs, rows);
  };

  // ---- quality-driven ----
  const highFlags = dataQuality.flags.filter((f) => f.level === "high");
  if (highFlags.length > 0) {
    insights.push({
      id: "quality_high",
      severity: "high",
      confidence: roleConf("date", "qty"),
      title: "Data quality blocks reliable measurement",
      body: `${highFlags.length} high-severity issue(s) were found. ${highFlags[0].message}`,
      action: "Review flagged columns in the dataset and fix or exclude them before relying on the metrics below.",
    });
  }
  const offender = dataQuality.columns.find((c) => c.role === "date" && c.missing_pct > 40);
  if (offender) {
    insights.push({
      id: "date_missing",
      severity: "high",
      confidence: roleConf("date"),
      title: `Date column “${offender.label}” is mostly empty`,
      body: `${Math.round(offender.missing_pct)}% of date values are missing, so time-series and period comparisons can undercount.`,
      action: "Backfill or remap the date column before trusting trend metrics.",
    });
  }

  // ---- core KPIs ----
  if (kpis.revenue != null && rows > 0) {
    insights.push({
      id: "revenue_scale",
      severity: kpis.revenue >= 10000 ? "high" : kpis.revenue >= 1000 ? "medium" : "low",
      confidence: roleConf("qty", "unit_price", "revenue"),
      title: `Revenue of ${fmtCurrency(kpis.revenue)} over ${rows.toLocaleString()} row(s)`,
      body: comparison.label && comparison.delta_pct != null
        ? `Latest period (${comparison.label}) is ${fmtCurrency(comparison.current_value)}: ${comparison.delta_pct >= 0 ? "up" : "down"} ${fmtPct(comparison.delta_pct)} vs the prior period (${fmtCurrency(comparison.prior_value)}).`
        : "Set a date column with enough history to compare across periods.",
      action: null,
    });
  }

  // ---- period comparison ----
  if (comparison.label && comparison.delta_pct != null && Math.abs(comparison.delta_pct) >= 5) {
    const moving = comparison.delta_pct > 0 ? "increased" : "decreased";
    insights.push({
      id: "period_delta",
      severity: severityFor(comparison.delta_pct, 20),
      confidence: roleConf("date", "qty", "unit_price", "revenue"),
      title: `${comparison.label}: revenue ${moving} ${fmtPct(comparison.delta_pct)}`,
      body: `Revenue ${moving} from ${fmtCurrency(comparison.prior_value)} to ${fmtCurrency(comparison.current_value)} (Δ ${fmtCurrency(comparison.delta)}).`,
      action: "Break the period down by product and category to find the drivers.",
    });
  }

  // ---- refunds ----
  const refundRate = refund.refund_rate_pct;
  if (refundRate != null && refundRate > 1) {
    insights.push({
      id: "refunds",
      severity: severityFor(refundRate, 10),
      confidence: roleConf("refund", "qty"),
      title: `Refund rate of ${refundRate}%`,
      body: `Refunds total ${fmtCurrency(refund.refunds)} across ${refund.refund_rows} row(s) against ${fmtCurrency(refund.gross_revenue)} gross revenue.`,
      action: refund.estimated
        ? "There is no explicit refund column — refunds were estimated from negative quantities. Add a returns/refunds column for an exact figure."
        : "Triage the refunding items; the top refund products are a good place to start.",
    });
  }

  // ---- concentration ----
  if (concentration.available && concentration.top5_share_pct != null) {
    const share = concentration.top5_share_pct;
    const top = concentration.top5 ?? [];
    insights.push({
      id: "concentration",
      severity: severityFor(share, 70),
      confidence: roleConf("product", "qty", "unit_price", "revenue"),
      title: `Top-5 products drive ${share}% of revenue`,
      body: top.length
        ? `Concentrated revenue: ${top.slice(0, 3).map((t) => `${t.label} (${t.value})`).join(", ")}${top.length > 3 ? ", …" : ""}.`
        : "A small number of products account for most of the sales.",
      action: "If one product dominates, assess supply-chain exposure and promotional dependency.",
    });
  }

  // ---- top product ----
  const top = payload.topProducts[0];
  if (top && kpis.revenue != null && kpis.revenue > 0) {
    const productFields = metrics.find((m) => m.key === "distinct_products");
    insights.push({
      id: "top_product",
      severity: top.value / kpis.revenue >= 0.25 ? "high" : "medium",
      confidence: roleConf("product", "qty", "unit_price"),
      title: `Best seller: “${top.label}”`,
      body: `${top.label} contributed ${fmtCurrency(top.value)}${top.units != null ? ` (${top.units} units)` : ""}.`,
      action: productFields
        ? "Verify this product is priced to margin; best sellers can subsidize slow movers."
        : null,
    });
  }

  // ---- bottom products ----
  const bottom = payload.bottomProducts[0];
  if (bottom && kpis.revenue != null && top && bottom.value >= 0) {
    insights.push({
      id: "bottom_product",
      severity: "low",
      confidence: roleConf("product", "qty", "unit_price"),
      title: `Slow movers: “${bottom.label}”`,
      body: `${bottom.label} contributed only ${fmtCurrency(bottom.value)}.`,
      action: "Flag as a candidate for clearance or delisting after confirming margins.",
    });
  }

  // ---- time pattern ----
  const weekday = payload.weekdayPattern;
  if (weekday.length > 0) {
    const maxDay = [...weekday].sort((a, b) => b.value - a.value)[0];
    const sum = weekday.reduce((a, b) => a + b.value, 0);
    const share = sum > 0 ? (maxDay.value / sum) * 100 : 0;
    insights.push({
      id: "weekday_peak",
      severity: severityFor(share, 25),
      confidence: roleConf("date", "qty", "unit_price", "revenue"),
      title: `${maxDay.label} is the busiest day`,
      body: `${maxDay.label} accounts for ${Math.round(share)}% of the period's sales.`,
      action: "Schedule staffing and promotions around the peak day.",
    });
  }

  // ---- outliers ----
  if (metrics.find((m) => m.key === "revenue" && m.confidence === "high") && payload.quality.columns.some((c) => c.outlier)) {
    const names = payload.quality.columns.filter((c) => c.outlier).map((c) => `“${c.label}”`);
    insights.push({
      id: "outliers",
      severity: "medium",
      confidence: roleConf("qty", "unit_price", "revenue"),
      title: "Extreme values may distort averages",
      body: `${names.join(", ")} contain${names.length === 1 ? "s" : ""} values outside ~4 standard deviations of the mean.`,
      action: "Inspect and optionally filter those rows before publishing benchmark figures.",
    });
  }

  return insights.slice(0, 12);
}