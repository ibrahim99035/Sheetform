import type { AnalysisRpcPayload, AnalysisReport, Sensitivity } from "./types";
import {
  buildColumnMapping,
  computeDataQuality,
  confidenceScore,
  type DataQualitySummary,
} from "./quality";
import { computeMetrics } from "./metrics";
import { generateInsights } from "./insights";
import { renderMarkdown } from "./markdown";
import type { ColumnRole } from "@/lib/types";

function buildLimitations(payload: AnalysisRpcPayload, quality: DataQualitySummary): string[] {
  const lim: string[] = [];

  const unresolved = (Object.keys(payload.roles) as ColumnRole[])
    .map((r) => ({
      role: r,
      conf: confidenceScore(quality.columns.find((c) => c.role === r)?.role_confidence),
    }))
    .filter((x) => x.conf < 0.55);
  if (unresolved.length > 0) {
    lim.push(`Roles inferred with low confidence for: ${unresolved.map((u) => u.role).join(", ")} — verify before relying on dependent metrics.`);
  }

  if (payload.rows < 30) {
    lim.push("Sample size is small (< 30 rows); period deltas and percentages are volatile and may not generalize.");
  }

  if (!payload.roles.date) {
    lim.push("No date column was resolved, so time-series trends and period comparisons were skipped.");
  }
  if (payload.roles.refund && payload.refund.estimated) {
    lim.push("Refunds were estimated from negative quantities (no explicit refund column). This is an approximation.");
  }
  if (payload.rows === 0) {
    lim.push("The dataset has no live rows; all metrics are null.");
  }
  if (!payload.roles.cost) {
    lim.push("No cost column — COGS / gross margin are null unless a revenue column is present.");
  }
  if (payload.sensitivity === "patient_health" && !payload.roles.patient) {
    lim.push("This dataset is marked as patient-related, but no patient identifier column was resolved.");
  }

  return lim.slice(0, 8);
}

const FOLLOWUP_KNOWNS = [
  { role: "cost", question: "Do you monitor margins per product? Add a unit cost column to enable gross-margin and COGS benchmarking." },
  { role: "branch", question: "Do you want branch-level benchmarking? Add a branch/store column so datasets can be compared across outlets." },
  { role: "refund", question: "Is there a dedicated refunds/returns column you can include? It would make the refund rate exact instead of estimated." },
  { role: "patient", question: "For patient-level insights, consider adding a consent-compliant patient identifier." },
  { role: "transaction_id", question: "Capture a transaction/invoice number per line to enable avg-basket and repeat-purchase analysis." },
];

function buildFollowUps(payload: AnalysisRpcPayload): string[] {
  const qs: string[] = [];
  for (const { role, question } of FOLLOWUP_KNOWNS) {
    if (!payload.roles[role as ColumnRole]) qs.push(question);
  }
  if (payload.timeSeries.length >= 2) {
    qs.push("Should this report drill into the largest period changes, broken down by product and category?");
  }
  qs.push("Do you want to compare this dataset against the previous submission to track changes over time?");
  return qs.slice(0, 5);
}

export function runAnalysis(
  payload: AnalysisRpcPayload,
  datasetId: string,
  datasetName: string,
): AnalysisReport {
  const sensitivity: Sensitivity = payload.sensitivity ?? "sales_financial";
  const mode = payload.mode === "manual" ? "manual" : "auto";

  const columnMapping = buildColumnMapping(payload);
  const dataQuality = computeDataQuality(payload);
  const { metrics, outliers } = computeMetrics(payload);

  const byRoleConf = new Map<string, number>();
  for (const c of dataQuality.columns) {
    if (c.role) byRoleConf.set(c.role, confidenceScore(c.role_confidence));
  }
  const insights = generateInsights(payload, metrics, dataQuality, byRoleConf);

  const comparisonLabel =
    payload.comparison.label && payload.comparison.delta_pct != null
      ? `${payload.comparison.label} Δ ${payload.comparison.delta_pct}%`
      : null;

  const limitations = buildLimitations(payload, dataQuality);
  const followUps = buildFollowUps(payload);

  const report: Omit<AnalysisReport, "markdown"> = {
    datasetId,
    datasetName,
    sensitivity,
    mode,
    generatedAt: new Date().toISOString(),
    roles: payload.roles,
    columnMapping,
    dataQuality,
    metrics,
    outliers,
    timeSeries: payload.timeSeries,
    comparisonLabel,
    topProducts: payload.topProducts,
    bottomProducts: payload.bottomProducts,
    topCategories: payload.topCategories,
    weekdayPattern: payload.weekdayPattern,
    hourPattern: payload.hourPattern,
    insights,
    limitations,
    followUps,
  };

  return { ...report, markdown: renderMarkdown(report) };
}

export type { AnalysisReport, AnalysisRpcPayload } from "./types";

export { roleLabel } from "./roles";