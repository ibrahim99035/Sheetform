import type {
  AnalysisReport,
  ColumnMappingEntry,
  Insight,
  Metric,
  RankRow,
  TimePoint,
} from "./types";
import type { DataQualitySummary } from "./quality";
import { roleLabel } from "./roles";
import { fmtCurrency } from "../currency";

// ---- shared formatting ----

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${n}%`;
}

function confTag(conf: string | null | undefined): string {
  if (!conf) return "";
  return ` ***(confidence: ${conf})***`;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ---- section renderers ----

function renderColumnMapping(mapping: ColumnMappingEntry[]): string {
  const lines = [
    "## Column Mapping",
    "",
    "| Column | Label | Role | Role confidence |",
    "| --- | --- | --- | --- |",
  ];
  for (const c of mapping) {
    lines.push(
      `| ${esc(c.key)} | ${esc(c.label)} | ${c.role ? esc(roleLabel(c.role)) : "—"} | ${c.role_confidence ? c.role_confidence : "—"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderDataQuality(quality: DataQualitySummary): string {
  const lines = [
    "## Data Quality Summary",
    "",
    `- **Rows analyzed:** ${fmtNumber(quality.rows)}`,
    `- **Overall data quality score:** **${quality.score}/100** (${quality.grade})`,
    "",
  ];

  if (quality.flags.length > 0) {
    lines.push("**Flags:**", "");
    for (const f of quality.flags) {
      lines.push(`- [${f.level}] ${f.message}`);
    }
    lines.push("");
  }

  const roleCols = quality.columns.filter((c) => c.role);
  if (roleCols.length > 0) {
    lines.push(
      "**Column health (role columns):**",
      "",
      "| Column | Role | Missing % | Invalid % | Distinct % |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const c of roleCols) {
      lines.push(
        `| ${esc(c.label)} | ${esc(roleLabel(c.role!))} | ${fmtPct(c.missing_pct)} | ${fmtPct(c.invalid_pct)} | ${fmtPct(c.distinct_pct)} |`,
      );
    }
    lines.push("");
  } else {
    lines.push("No role columns were resolved — metrics below are unavailable or low-confidence.");
    lines.push("");
  }

  return lines.join("\n");
}

function renderMetrics(metrics: Metric[], outliers: { key: string; label: string }[]): string {
  const lines = [
    "## Computed Metrics",
    "",
    "| Metric | Value | Confidence |",
    "| --- | --- | --- |",
  ];
  for (const m of metrics) {
    const value =
      m.unit === "percent"
        ? fmtPct(m.value)
        : m.unit === "currency"
          ? fmtCurrency(m.value)
          : fmtNumber(m.value);
    lines.push(`| ${esc(m.label)} | ${value} | ${m.confidence} |`);
  }
  lines.push("");

  for (const m of metrics) {
    if (m.note) {
      lines.push(`- _${m.label}: ${m.note}_`);
    }
  }
  if (outliers.length > 0) {
    lines.push(
      "",
      `> ⚠ Found extreme-value outlier column(s): ${outliers.map((o) => `“${o.label}”`).join(", ")}. Averages may be skewed.`,
    );
  }
  if (metrics.some((m) => m.note)) lines.push("");

  return lines.join("\n");
}

function renderRanks(
  title: string,
  rows: RankRow[],
  kind: "products" | "categories",
): string {
  if (rows.length === 0) return "";
  const lines = [
    "",
    `**${title}**`,
    "",
    `| ${kind === "products" ? "Product" : "Category"} | Value | Units | Rows |`,
    "| --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${esc(r.label)} | ${fmtCurrency(r.value)} | ${r.units != null ? fmtNumber(r.units) : "—"} | ${fmtNumber(r.grp_count)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderTimeSeries(series: TimePoint[]): string {
  if (series.length === 0) return "";
  const lines = [
    "",
    "**Revenue trend:**",
    "",
    "| Period | Value |",
    "| --- | --- |",
  ];
  for (const p of series) {
    lines.push(`| ${esc(p.bucket)} | ${fmtCurrency(p.value)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderInsights(insights: Insight[]): string {
  const lines = ["## Key Insights & Recommended Actions", ""];
  if (insights.length === 0) {
    lines.push("No actionable insights were generated — too little data or no resolvable roles.");
    lines.push("");
    return lines.join("\n");
  }
  for (const ins of insights) {
    lines.push(`### [${ins.severity.toUpperCase()}] ${ins.title}${confTag(ins.confidence)}`);
    lines.push("");
    lines.push(ins.body);
    if (ins.action) {
      lines.push("");
      lines.push(`**Recommended action:** ${ins.action}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderLimitations(limitations: string[]): string {
  const lines = ["## Limitations & Assumptions", ""];
  if (limitations.length === 0) {
    lines.push("- None recorded.");
    lines.push("");
    return lines.join("\n");
  }
  for (const l of limitations) lines.push(`- ${l}`);
  lines.push("");
  return lines.join("\n");
}

function renderFollowUps(followUps: string[]): string {
  const lines = ["## Suggested Follow-up Questions", ""];
  if (followUps.length === 0) {
    lines.push(
      "1. Do you want to compare this dataset across periods or branches for a fuller picture?",
      "",
    );
    return lines.join("\n");
  }
  followUps.forEach((q, i) => {
    lines.push(`${i + 1}. ${q}`);
  });
  lines.push("");
  return lines.join("\n");
}

// ---- top-level renderer ----

export function renderMarkdown(report: Omit<AnalysisReport, "markdown">): string {
  const lines: string[] = [];
  lines.push(
    `# SiroQ Analysis — ${report.datasetName}`,
    "",
    `> _Automated, deterministic analysis (no LLM). Confidence derives from schema confidence × role coverage × sample size._`,
    "",
    `- **Generated:** ${report.generatedAt}`,
    `- **Sensitivity:** ${report.sensitivity}`,
    `- **Mode:** ${report.mode === "auto" ? "auto role inference" : "manual role selection"}`,
    "",
  );

  lines.push(renderColumnMapping(report.columnMapping));
  lines.push(renderDataQuality(report.dataQuality));
  lines.push(renderMetrics(report.metrics, report.outliers));

  lines.push(renderTimeSeries(report.timeSeries));
  if (report.comparisonLabel) {
    lines.push(`**Period comparison (latest):** ${report.comparisonLabel}`);
    lines.push("");
  }
  lines.push(renderRanks("Top products", report.topProducts, "products"));
  lines.push(renderRanks("Bottom products", report.bottomProducts, "products"));
  lines.push(renderRanks("Top categories", report.topCategories, "categories"));
  lines.push(renderRanks("Sales by weekday", report.weekdayPattern, "categories"));

  lines.push(renderInsights(report.insights));
  lines.push(renderLimitations(report.limitations));
  lines.push(renderFollowUps(report.followUps));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}