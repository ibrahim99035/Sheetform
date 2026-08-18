import type {
  AnalysisRpcPayload,
  ColumnMappingEntry,
  MetricConfidence,
  QualityProfileColumn,
  Severity,
} from "./types";
import { roleLabel } from "./roles";

export interface ColumnQualityRow {
  key: string;
  label: string;
  type: QualityProfileColumn["type"];
  role: QualityProfileColumn["role"];
  role_confidence: QualityProfileColumn["role_confidence"];
  missing_pct: number;
  invalid_pct: number;
  distinct_pct: number;
}

export interface DataQualitySummary {
  rows: number;
  score: number;
  grade: string;
  columns: ColumnQualityRow[];
  flags: { level: Severity; message: string }[];
}

const GRADE_THRESHOLDS: [number, string][] = [
  [90, "excellent"],
  [75, "good"],
  [60, "acceptable"],
  [45, "poor"],
];

export function gradeFor(score: number): string {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (score >= threshold) return grade;
  }
  return "unusable";
}

function pct(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

const MONEY_ROLES = new Set(["qty", "unit_price", "cost", "revenue", "expense", "tax"]);

// Overall quality score (0-100): heavily weighted on role columns, since they
// drive the metrics. Deducts for missing/invalid values and outliers on the
// money/identity columns that the KPI layer reads.
function scoreProfile(columns: QualityProfileColumn[], rows: number): { score: number; grade: string } {
  if (rows === 0) return { score: 0, grade: gradeFor(0) };
  if (columns.length === 0) return { score: 0, grade: gradeFor(0) };

  let score = 100;
  for (const c of columns) {
    const missing = pct(c.missing_pct);
    const invalid = pct(c.invalid_pct);
    const isRole = c.role != null;
    const weight = isRole ? 2 : 1;

    if (c.role && MONEY_ROLES.has(c.role) && c.outlier) score -= 4 * weight;
    if (missing > 0) score -= Math.min(20, missing) * weight * 0.6;
    if (invalid > 0) score -= Math.min(15, invalid) * weight * 0.8;
    if (isRole && missing > 40) score -= 10;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: gradeFor(score) };
}

function buildFlags(columns: QualityProfileColumn[], rows: number): { level: Severity; message: string }[] {
  const flags: { level: Severity; message: string }[] = [];
  if (rows === 0) {
    flags.push({ level: "high", message: "The dataset has no live rows." });
  }

  for (const c of columns) {
    const missing = pct(c.missing_pct);
    const invalid = pct(c.invalid_pct);
    const name = c.label || c.key;

    if (c.role && missing > 40) {
      flags.push({
        level: "high",
        message: `Column “${name}” (${roleLabel(c.role)}) is missing ${Math.round(missing)}% of values — metrics relying on it will be unreliable.`,
      });
    } else if (c.role && missing > 10) {
      flags.push({
        level: "medium",
        message: `Column “${name}” (${roleLabel(c.role)}) is missing ${Math.round(missing)}% of values.`,
      });
    }
    if (c.role && invalid > 5) {
      flags.push({
        level: "medium",
        message: `${Math.round(invalid)}% of “${name}” values could not be parsed as ${c.type}.`,
      });
    }
    if (c.role !== "transaction_id" && c.role !== "sku" && c.outlier) {
      flags.push({
        level: "medium",
        message: `Column “${name}” has extreme values outside ~4 standard deviations that may distort benchmark averages.`,
      });
    }
  }

  return flags.slice(0, 12);
}

const ROLE_PRIORITY: Record<string, number> = {
  date: 0, qty: 1, unit_price: 2, cost: 3, revenue: 4, refund: 5,
  transaction_id: 6, product: 7, category: 8, sku: 9, tax: 10, account: 11,
  expense: 12, branch: 13, patient: 14,
};

// ## Column Mapping section: every column, its inferred role, and the
// confidence of that inference (as stamped at import time / by the resolver).
export function buildColumnMapping(payload: AnalysisRpcPayload): ColumnMappingEntry[] {
  return [...payload.quality.columns]
    .sort((a, b) => {
      const ra = a.role != null ? ROLE_PRIORITY[a.role] ?? 99 : 99;
      const rb = b.role != null ? ROLE_PRIORITY[b.role] ?? 99 : 99;
      return ra - rb || a.label.localeCompare(b.label);
    })
    .map((c) => ({
      key: c.key,
      label: c.label,
      role: c.role,
      role_confidence: c.role_confidence,
    }));
}

export function computeDataQuality(payload: AnalysisRpcPayload): DataQualitySummary {
  const cols = payload.quality.columns;
  const { score, grade } = scoreProfile(cols, payload.rows);
  const flags = buildFlags(cols, payload.rows);
  const columns: ColumnQualityRow[] = [...cols]
    .sort((a, b) => {
      const ra = a.role != null ? ROLE_PRIORITY[a.role] ?? 99 : 99;
      const rb = b.role != null ? ROLE_PRIORITY[b.role] ?? 99 : 99;
      return ra - rb || a.label.localeCompare(b.label);
    })
    .map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      role: c.role,
      role_confidence: c.role_confidence,
      missing_pct: c.missing_pct,
      invalid_pct: c.invalid_pct,
      distinct_pct: c.distinct_pct,
    }));

  return { rows: payload.rows, score, grade, columns, flags };
}

// Confidence from role_confidence; used to seed metric/insight confidence.
const CONFIDENCE_VALUE: Record<MetricConfidence, number> = { high: 1, medium: 0.7, low: 0.4 };

export function confidenceScore(c?: MetricConfidence | null): number {
  if (!c) return 0.7;
  return CONFIDENCE_VALUE[c];
}

// Sample-size discount: tiny datasets are volatile. Rows below 4 collapse to
// "low"; a small-but-clean 4-row file stays "medium".
export function sampleFactor(rows: number): number {
  if (rows >= 100) return 1;
  if (rows >= 30) return 0.9;
  if (rows >= 15) return 0.8;
  if (rows >= 8) return 0.75;
  if (rows >= 4) return 0.7;
  return 0.4;
}

// Scale a raw confidence product through the size factor into a tag.
// product is the min role-confidence (0..1) across the involved columns.
export function scaleConfidence(product: number, rows: number): MetricConfidence {
  const c = product * sampleFactor(rows);
  if (c >= 0.85) return "high";
  if (c >= 0.5) return "medium";
  return "low";
}