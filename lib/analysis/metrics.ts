import type {
  AnalysisRpcPayload,
  Metric,
  MetricConfidence,
  QualityProfileColumn,
} from "./types";
import { confidenceScore, scaleConfidence } from "./quality";

// A metric's confidence = min(role confidence of the columns it reads, with
// a default when no role column pins it) × availability (data exists) × a
// sample-size factor. Mirrors the spec: confidence derives from
// schema-confidence × coverage × sample size.

function confidenceOf(
  rolesSynced: string[],
  byRole: Map<string, QualityProfileColumn>,
  available: boolean,
  rows: number,
): MetricConfidence {
  if (!available) return "low";
  let conf = 1;
  let pinned = false;
  for (const role of rolesSynced) {
    const col = byRole.get(role);
    if (!col) {
      conf = Math.min(conf, 0.4);
      continue;
    }
    pinned = true;
    conf = Math.min(conf, confidenceScore(col.role_confidence));
  }
  if (!pinned && rolesSynced.length > 0) conf = Math.min(conf, 0.4);
  else if (!pinned) conf = 1;
  return scaleConfidence(conf, rows);
}

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: Metric["unit"],
  confidence: MetricConfidence,
  note?: string,
): Metric {
  return { key, label, value, unit, confidence, note };
}

function round2(n: number | null): number | null {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

export interface MetricsResult {
  metrics: Metric[];
  outliers: { key: string; label: string }[];
}

export function computeMetrics(payload: AnalysisRpcPayload): MetricsResult {
  const { kpis } = payload;
  const byRole = new Map<string, QualityProfileColumn>();
  for (const c of payload.quality.columns) {
    if (c.role && payload.roles[c.role]) byRole.set(c.role, c);
  }

  // Roles a metric actually reads: qty*price path, dynamic revenue-col path,
  // or whichever alternative is present. The `revenue` role and `transaction_id`
  // are alternatives to qty*price, so they are only "needed" when used.
  const revPath = (extra: string[] = []): string[] => {
    if (byRole.has("qty") && byRole.has("unit_price")) return ["qty", "unit_price", ...extra];
    if (byRole.has("revenue")) return ["revenue", ...extra];
    return ["qty", "unit_price", ...extra];
  };

  const metrics: Metric[] = [];
  const outliers: { key: string; label: string }[] = [];

  // revenue
  const revenueAvail = (kpis.revenue ?? null) != null;
  metrics.push(
    metric("revenue", "Gross revenue", round2(kpis.revenue), "currency",
      confidenceOf(revPath(), byRole, revenueAvail, payload.rows)),
  );

  // units
  const unitsAvail = (kpis.units ?? null) != null;
  metrics.push(
    metric("units", "Units sold", round2(kpis.units), "number",
      confidenceOf(["qty"], byRole, unitsAvail, payload.rows)),
  );

  // distinct products
  const productsAvail = (kpis.distinct_products ?? null) != null;
  metrics.push(
    metric("distinct_products", "Distinct products", round2(kpis.distinct_products), "number",
      confidenceOf(["product"], byRole, productsAvail, payload.rows)),
  );

  // cogs
  const cogsAvail = (kpis.cogs ?? null) != null;
  metrics.push(
    metric("cogs", "Cost of goods sold", round2(kpis.cogs), "currency",
      confidenceOf(byRole.has("qty") && byRole.has("cost") ? ["qty", "cost"] : ["cost"], byRole, cogsAvail, payload.rows)),
  );

  // gross margin + %
  const marginAvail = (kpis.gross_margin ?? null) != null;
  metrics.push(
    metric("gross_margin", "Gross margin", round2(kpis.gross_margin), "currency",
      confidenceOf([...revPath(), ...(byRole.has("qty") && byRole.has("cost") ? ["cost"] : [])], byRole, marginAvail, payload.rows)),
  );
  metrics.push(
    metric("gross_margin_pct", "Gross margin (%)", round2(kpis.gross_margin_pct), "percent",
      confidenceOf([...revPath(), ...(byRole.has("qty") && byRole.has("cost") ? ["cost"] : [])], byRole, marginAvail, payload.rows)),
  );

  // expenses (only when expense column present)
  if (kpis.expenses != null) {
    metrics.push(
      metric("expenses", "Expenses", round2(kpis.expenses), "currency",
        confidenceOf(["expense"], byRole, kpis.expenses != null, payload.rows)),
    );
  }

  // avg transaction
  const ticketAvail = (kpis.avg_transaction ?? null) != null;
  metrics.push(
    metric("avg_transaction", "Avg transaction value", round2(kpis.avg_transaction), "currency",
      confidenceOf(revPath(["transaction_id"]), byRole, ticketAvail, payload.rows)),
  );

  // refund rate
  const refundsAvail = payload.refund.refund_rate_pct != null;
  metrics.push(
    metric(
      "refund_rate",
      "Refund rate",
      round2(payload.refund.refund_rate_pct),
      "percent",
      confidenceOf(byRole.has("refund") ? ["refund"] : ["qty"], byRole, refundsAvail, payload.rows),
      payload.refund.estimated
        ? "estimated from negative quantities (no explicit refund column)"
        : undefined,
    ),
  );

  // concentration
  if (payload.concentration.available) {
    metrics.push(
      metric(
        "concentration_top",
        "Top-5 product revenue share",
        round2(payload.concentration.top5_share_pct ?? null),
        "percent",
        confidenceOf(revPath(["product"]), byRole, true, payload.rows),
      ),
    );
    metrics.push(
      metric(
        "concentration_distinct",
        "Distinct products (revenue profile)",
        round2(payload.concentration.distinct_products ?? null),
        "number",
        confidenceOf(["product"], byRole, true, payload.rows),
      ),
    );
  }

  // period change
  if (payload.comparison.label && payload.comparison.delta_pct != null) {
    metrics.push(
      metric(
        "period_change",
        `${payload.comparison.label} vs prior period`,
        round2(payload.comparison.delta_pct),
        "percent",
        confidenceOf(revPath(["date"]), byRole, true, payload.rows),
        `Δ ${payload.comparison.delta} → ${payload.comparison.current_value} (prior ${payload.comparison.prior_value})`,
      ),
    );
  }

  for (const c of payload.quality.columns) {
    if (isOutlierRole(c.role) && c.outlier) {
      outliers.push({ key: c.key, label: c.label });
    }
  }

  return { metrics, outliers };
}

const OUTLIER_ROLES = new Set(["qty", "unit_price", "cost", "revenue", "expense"]);

function isOutlierRole(role: string | null | undefined): boolean {
  return role != null && OUTLIER_ROLES.has(role);
}