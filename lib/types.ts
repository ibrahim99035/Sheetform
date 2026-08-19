export type ColumnType = "string" | "numeric" | "date" | "boolean";

/** What a dataset represents. Sales = POS transactions; inventory = stock
 * snapshots (expiry + stock_on_hand), feeding ABC-XYZ / safety-stock / expiry
 * analytics. */
export type DatasetKind = "sales" | "inventory";

/** A row in an inventory dataset (datasets.kind = 'inventory'). */
export interface InventoryRow {
  product: string;
  sku?: string | null;
  expiry_date: string | null;
  stock_on_hand: number | null;
  unit_cost?: number | null;
}

/** Tenant opt-in for anonymized cross-pharmacy benchmarking. */
export interface BenchmarkOptIn {
  enabled: boolean;
  region?: string | null;
  optedInAt?: string | null;
}

export type ColumnRole =
  | "date"
  | "branch"
  | "transaction_id"
  | "product"
  | "category"
  | "qty"
  | "unit_price"
  | "cost"
  | "refund"
  | "sku"
  | "revenue"
  | "expense"
  | "tax"
  | "account"
  | "patient";

export type RoleConfidence = "high" | "medium" | "low";

export interface ColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  role?: ColumnRole;
  role_confidence?: RoleConfidence;
}

export type DatasetStatus = "pending" | "processing" | "ready" | "error";

export interface Dataset {
  id: string;
  owner_id: string;
  name: string;
  original_filename: string;
  storage_path: string;
  status: DatasetStatus;
  error_message: string | null;
  row_count: number;
  column_defs: ColumnDef[];
  sheet_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatasetRow {
  id: number;
  row_index: number;
  data: Record<string, unknown>;
  deleted_at: string | null;
}

export interface ColumnStats {
  dataset_id: string;
  column_key: string;
  min: number | null;
  max: number | null;
  avg: number | null;
  sum: number | null;
  distinct_count: number | null;
  null_count: number | null;
  invalid_count: number | null;
  computed_at: string;
}

export interface Operation {
  id: number;
  dataset_id: string;
  user_id: string;
  operation_type: string;
  payload: Record<string, unknown>;
  inverse_payload: Record<string, unknown>;
  applied_at: string;
  undone_at: string | null;
}

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  key: string;
  dir: SortDirection;
}

export type FilterOp =
  | "contains"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

export interface FilterSpec {
  key: string;
  op: FilterOp;
  value: string;
}

export interface ViewState {
  sort: SortSpec | null;
  filters: FilterSpec[];
}

export interface GroupByResult {
  label: string;
  value: number | null;
  count: number;
}

export type ImportErrorKind =
  | "EMPTY_SHEET"
  | "NO_DATA"
  | "TOO_MANY_ROWS"
  | "UNSUPPORTED"
  | "NOT_FOUND"
  | "AUTH";

export interface InspectSheetInfo {
  name: string;
  header: string[];
  hasData: boolean;
  rowEstimate: number;
}

export interface InspectResult {
  decision:
    | { kind: "single"; sheet: InspectSheetInfo }
    | { kind: "auto_populated"; sheet: InspectSheetInfo; skipped: string[] }
    | { kind: "picker"; sheets: InspectSheetInfo[] }
    | { kind: "error"; error: ImportErrorKind; message: string };
}

export interface InferredColumn {
  key: string;
  label: string;
  type: ColumnType;
  role?: ColumnRole;
  role_confidence?: RoleConfidence;
}
