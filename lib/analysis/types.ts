import type { ColumnRole, ColumnType, RoleConfidence } from "@/lib/types";

export type Sensitivity = "none" | "sales_financial" | "patient_health";
export type MetricConfidence = RoleConfidence;
export type Severity = "high" | "medium" | "low";

// ---- Inputs: normalized shapes of the SQL engine RPC payloads ----

export interface QualityProfileColumn {
  key: string;
  label: string;
  type: ColumnType;
  role: ColumnRole | null;
  role_confidence: RoleConfidence | null;
  missing_pct: number;
  invalid_pct: number;
  distinct_pct: number;
  negative_count: number;
  outlier: boolean;
  currency_symbols: string | null;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export interface QualityProfile {
  rows: number;
  columns: QualityProfileColumn[];
  flags: { level: Severity; message: string }[];
}

export interface DatasetKpis {
  rows: number | null;
  distinct_products: number | null;
  revenue: number | null;
  units: number | null;
  cogs: number | null;
  expenses: number | null;
  gross_margin: number | null;
  gross_margin_pct: number | null;
  avg_transaction: number | null;
  min_date: string | null;
  max_date: string | null;
}

export interface RefundResult {
  gross_revenue: number | null;
  refunds: number | null;
  refund_rows: number | null;
  refund_rate_pct: number | null;
  estimated: boolean;
}

export interface ConcentrationColumn {
  label: string;
  value: number;
}

export interface ConcentrationResult {
  available: boolean;
  total_revenue?: number | null;
  distinct_products?: number | null;
  top5?: ConcentrationColumn[];
  top?: ConcentrationColumn[];
  top5_share_pct?: number | null;
  top_n_share_pct?: number | null;
}

export interface RankRow {
  label: string;
  value: number;
  units: number | null;
  grp_count: number;
}

export interface TimePoint {
  bucket: string;
  value: number;
}

export interface CompareRow {
  label: string | null;
  current_value: number | null;
  prior_value: number | null;
  delta: number | null;
  delta_pct: number | null;
}

export interface AnalysisRpcPayload {
  roles: Partial<Record<ColumnRole, string>>;
  quality: QualityProfile;
  kpis: DatasetKpis;
  timeSeries: TimePoint[];
  comparison: CompareRow;
  refund: RefundResult;
  concentration: ConcentrationResult;
  topProducts: RankRow[];
  bottomProducts: RankRow[];
  topCategories: RankRow[];
  weekdayPattern: RankRow[];
  hourPattern: RankRow[];
  rows: number;
  columns: { key: string; label: string; type: ColumnType }[];
  sensitivity?: Sensitivity;
  mode?: "auto" | "manual";
}

export interface ColumnMappingEntry {
  key: string;
  label: string;
  role: ColumnRole | null;
  role_confidence: RoleConfidence | null;
}

// ---- Output: full engine report ----

export interface DataQualitySummary {
  rows: number;
  score: number;
  grade: string;
  flags: { level: Severity; message: string }[];
  columns: {
    key: string;
    label: string;
    type: ColumnType;
    role: ColumnRole | null;
    role_confidence: RoleConfidence | null;
    missing_pct: number;
    invalid_pct: number;
    distinct_pct: number;
  }[];
}

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: "currency" | "number" | "percent";
  confidence: MetricConfidence;
  note?: string;
}

export interface Insight {
  id: string;
  severity: Severity;
  confidence: MetricConfidence;
  title: string;
  body: string;
  action: string | null;
}

export interface AnalysisReport {
  datasetId: string;
  datasetName: string;
  sensitivity: Sensitivity;
  mode: "auto" | "manual";
  generatedAt: string;
  roles: Partial<Record<ColumnRole, string>>;
  columnMapping: { key: string; label: string; role: ColumnRole | null; role_confidence: RoleConfidence | null }[];
  dataQuality: DataQualitySummary;
  metrics: Metric[];
  outliers: { key: string; label: string }[];
  timeSeries: TimePoint[];
  comparisonLabel: string | null;
  topProducts: RankRow[];
  bottomProducts: RankRow[];
  topCategories: RankRow[];
  weekdayPattern: RankRow[];
  hourPattern: RankRow[];
  insights: Insight[];
  limitations: string[];
  followUps: string[];
  markdown: string;
}