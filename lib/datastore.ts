import type { SupabaseClient } from "@supabase/supabase-js";
import type { ColumnDef, ColumnStats, GroupByResult, ViewState } from "@/lib/types";
import {
  type AddColumnParams,
  type GroupByParams,
  type OpResult,
  type RowRecord,
  fetchGroupBy as supabaseFetchGroupBy,
  fetchRowCount as supabaseFetchRowCount,
  fetchRows as supabaseFetchRows,
  addColumn as supabaseAddColumn,
  applyOperation as supabaseApplyOperation,
  redoOperation as supabaseRedoOperation,
  undoOperation as supabaseUndoOperation,
} from "@/lib/dataset-api";
import { executeSql, queryRows } from "@/lib/db/duckdb";
import {
  type DatasetSnapshot,
  isOpfsAvailable,
  loadDataset,
  loadOps,
  persistDataset,
  persistOps,
  sanitizeId,
} from "@/lib/db/opfs";

export { sanitizeId };

export type DataEngine = "duckdb" | "supabase";

export interface DataStore {
  engine: DataEngine;
  fetchRows(
    datasetId: string,
    view: ViewState,
    pageSize?: number,
    offset?: number,
  ): Promise<RowRecord[]>;
  fetchRowCount(datasetId: string, view: ViewState): Promise<number>;
  fetchGroupBy(
    datasetId: string,
    params: GroupByParams,
    view?: ViewState,
  ): Promise<GroupByResult[]>;
  applyOperation(
    datasetId: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<OpResult>;
  undoOperation(datasetId: string): Promise<OpResult>;
  redoOperation(datasetId: string): Promise<OpResult>;
  addColumn(datasetId: string, params: AddColumnParams): Promise<OpResult>;
  /** Per-column profile for the Analyze tab (recomputed locally on duckdb).
   *  The supabase store proxies the existing `dataset_column_stats` table. */
  computeStats(datasetId: string, columns: ColumnDef[]): Promise<ColumnStats[]>;
}

export function getDataEngine(): DataEngine {
  return (process.env.NEXT_PUBLIC_DATA_ENGINE as DataEngine | undefined) === "supabase"
    ? "supabase"
    : "duckdb";
}

/**
 * Capability detector for the local-first data plane. We only route to the
 * in-browser (DuckDB + OPFS) engine when the browser can actually persist
 * datasets; otherwise we keep the server (supabaseStore) as the fallback.
 */
export function canUseLocalEngine(): boolean {
  if (getDataEngine() === "supabase") return false;
  return isOpfsAvailable();
}

export function createDataStore(client: SupabaseClient): DataStore {
  return canUseLocalEngine() ? createDuckDBStore() : createSupabaseStore(client);
}

export function createSupabaseStore(client: SupabaseClient): DataStore {
  return {
    engine: "supabase",
    fetchRows: (id, view, pageSize, offset) =>
      supabaseFetchRows(client, id, view, pageSize ?? 200, offset ?? 0),
    fetchRowCount: (id, view) => supabaseFetchRowCount(client, id, view),
    fetchGroupBy: (id, params, view) => supabaseFetchGroupBy(client, id, params, view),
    applyOperation: (id, op, params) => supabaseApplyOperation(client, id, op, params),
    undoOperation: (id) => supabaseUndoOperation(client, id),
    redoOperation: (id) => supabaseRedoOperation(client, id),
    addColumn: (id, params) => supabaseAddColumn(client, id, params),
    computeStats: async (id) => {
      const { data, error } = await client
        .from("dataset_column_stats")
        .select("*")
        .eq("dataset_id", id);
      if (error) throw new Error(error.message);
      return (data ?? []) as ColumnStats[];
    },
  };
}

// ---------------------------------------------------------------------------
// Local-first store: everything runs in DuckDB-WASM, persisted via OPFS.
// ---------------------------------------------------------------------------

const MAX_PAGE = 1000;

export function tableName(datasetId: string): string {
  return `ds_${sanitizeId(datasetId)}`;
}

export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function lit(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

interface LocalOp {
  operation: "rename_column" | "filter_rows" | "edit_cell" | "dedupe" | "add_column";
  payload: Record<string, unknown>;
  inverse: Record<string, unknown>;
}

interface LoadedDataset {
  cols: ColumnDef[];
  undo: LocalOp[];
  redo: LocalOp[];
}

const loaded = new Map<string, LoadedDataset>();

/** Drop the in-memory DuckDB table + cached state for a dataset (used after a
 *  restore so the next store call re-loads from the new OPFS snapshot). */
export function forgetLocalDataset(datasetId: string): void {
  loaded.delete(datasetId);
}

/** Public entry point that guarantees the in-memory DuckDB table for a dataset
 *  is loaded and current (reloads from the OPFS snapshot if needed). */
export function ensureTableLoaded(datasetId: string): Promise<LoadedDataset> {
  return ensureLoaded(datasetId);
}

const DDB_TYPE: Record<string, string> = {
  string: "VARCHAR",
  numeric: "DOUBLE",
  date: "DATE",
  boolean: "BOOLEAN",
};

async function loadIntoDuck(table: string, snapshot: DatasetSnapshot): Promise<void> {
  const cols = snapshot.columnDefs;
  const colsList = [...cols.map((c) => ident(c.key)), "__rowno"].join(", ");

  // Create typed columns, infer a stable row number for op targeting.
  await executeSql(`
    CREATE OR REPLACE TABLE ${ident(table)} (
      __rowno BIGINT
      ${cols.map((c) => `, ${ident(c.key)} ${DDB_TYPE[c.type] ?? "VARCHAR"}`).join("")}
    )
  `);
  if (snapshot.rows.length > 0) {
    const rowsSql = snapshot.rows
      .map(
        (r, i) =>
          `(${i}, ${cols.map((c) => lit(r[c.key] ?? null)).join(", ")})`,
      )
      .join(",\n");
    await executeSql(
      `INSERT INTO ${ident(table)} (__rowno, ${colsList}) VALUES ${rowsSql}`,
    );
  }
}

async function ensureLoaded(datasetId: string): Promise<LoadedDataset> {
  const cached = loaded.get(datasetId);
  if (cached) return cached;

  const snapshot = await loadDataset(datasetId);
  if (!snapshot) {
    throw new Error(
      "This dataset has not been loaded into the browser yet. Open it once from the dataset page to sync it locally.",
    );
  }
  await loadIntoDuck(tableName(datasetId), snapshot);
  const ops = await loadOps(datasetId);
  const state: LoadedDataset = {
    cols: snapshot.columnDefs,
    undo: ops?.operations?.map(toLocalOp).filter(Boolean) as LocalOp[] ?? [],
    redo: [],
  };
  loaded.set(datasetId, state);
  return state;
}

function toLocalOp(op: { operation_type: string; payload: Record<string, unknown>; inverse_payload: Record<string, unknown> }): LocalOp | null {
  const type = op.operation_type as LocalOp["operation"];
  if (
    type !== "rename_column" &&
    type !== "filter_rows" &&
    type !== "edit_cell" &&
    type !== "dedupe" &&
    type !== "add_column"
  ) {
    return null;
  }
  return { operation: type, payload: op.payload, inverse: op.inverse_payload };
}

async function dumpTableRows(
  datasetId: string,
  cols: ColumnDef[],
): Promise<Record<string, unknown>[]> {
  const t = tableName(datasetId);
  const colsList = cols.map((c) => ident(c.key)).join(", ");
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT ${colsList} FROM ${ident(t)} ORDER BY __rowno ASC`,
  );
  return rows;
}

async function persistState(datasetId: string, state: LoadedDataset): Promise<void> {
  const current = await dumpTableRows(datasetId, state.cols);
  const snapshot: DatasetSnapshot = {
    columnDefs: state.cols,
    rows: current,
    sourceFile: null,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await persistDataset(datasetId, snapshot);
  await persistOps(datasetId, {
    operations: state.undo.map((op) => ({
      id: 0,
      dataset_id: datasetId,
      user_id: "",
      operation_type: op.operation,
      payload: op.payload,
      inverse_payload: op.inverse,
      applied_at: new Date().toISOString(),
      undone_at: null,
    })),
  });
}

function resolveColumn(state: LoadedDataset, keyOrLabel: string): ColumnDef | undefined {
  return state.cols.find((c) => c.key === keyOrLabel || c.label === keyOrLabel);
}

export function buildWhere(state: LoadedDataset, view: ViewState): string {
  const clauses: string[] = [];
  for (const f of view.filters ?? []) {
    const col = resolveColumn(state, f.key);
    if (!col) continue; // filter on unknown column — ignore, mirrors server leniency
    const q = ident(col.key);
    const castNum = DDB_TYPE[col.type] === "DOUBLE" ? `CAST(${q} AS DOUBLE)` : q;
    const castDate = DDB_TYPE[col.type] === "DATE" ? `CAST(${q} AS DATE)` : q;
    switch (f.op) {
      case "contains":
        clauses.push(`CAST(${q} AS VARCHAR) ILIKE '%' || ${lit(f.value)} || '%'`);
        break;
      case "equals":
        clauses.push(castNum === q ? `${q} = ${lit(f.value)}` : f.value === "" ? `${q} IS NULL OR ${q} = ''` : `${q} = ${lit(f.value)}`);
        break;
      case "not_equals":
        clauses.push(`${q} IS DISTINCT FROM ${lit(f.value)}`);
        break;
      case "gt":
        clauses.push(col.type === "numeric" ? `${castNum} > CAST(${lit(f.value)} AS DOUBLE)` : col.type === "date" ? `${castDate} > CAST(${lit(f.value)} AS DATE)` : `${q} > ${lit(f.value)}`);
        break;
      case "gte":
        clauses.push(col.type === "numeric" ? `${castNum} >= CAST(${lit(f.value)} AS DOUBLE)` : col.type === "date" ? `${castDate} >= CAST(${lit(f.value)} AS DATE)` : `${q} >= ${lit(f.value)}`);
        break;
      case "lt":
        clauses.push(col.type === "numeric" ? `${castNum} < CAST(${lit(f.value)} AS DOUBLE)` : col.type === "date" ? `${castDate} < CAST(${lit(f.value)} AS DATE)` : `${q} < ${lit(f.value)}`);
        break;
      case "lte":
        clauses.push(col.type === "numeric" ? `${castNum} <= CAST(${lit(f.value)} AS DOUBLE)` : col.type === "date" ? `${castDate} <= CAST(${lit(f.value)} AS DATE)` : `${q} <= ${lit(f.value)}`);
        break;
      case "is_empty":
        clauses.push(`${q} IS NULL OR ${q} = ''`);
        break;
      case "is_not_empty":
        clauses.push(`${q} IS NOT NULL AND ${q} <> ''`);
        break;
    }
  }
  return clauses.length > 0 ? clauses.join(" AND ") : "1=1";
}

function createDuckDBStore(): DataStore {
  return {
    engine: "duckdb",

    async fetchRows(datasetId, view, pageSize = 200, offset = 0) {
      const state = await ensureLoaded(datasetId);
      const t = tableName(datasetId);
      const where = buildWhere(state, view);
      const colsList = state.cols.map((c) => ident(c.key)).join(", ");
      const order = view.sort
        ? `ORDER BY ${ident(view.sort.key)} ${view.sort.dir === "desc" ? "DESC" : "ASC"}`
        : "ORDER BY __rowno ASC";
      const size = Math.min(pageSize ?? 200, MAX_PAGE);
      const rows = await queryRows<Record<string, unknown>>(
        `SELECT __rowno, ${colsList} FROM ${ident(t)} WHERE ${where} ${order} LIMIT ${size} OFFSET ${offset}`,
      );
      return rows.map((r) => {
        const { __rowno, ...data } = r;
        return { row_id: Number(__rowno), row_index: Number(__rowno), data };
      });
    },

    async fetchRowCount(datasetId, view) {
      const state = await ensureLoaded(datasetId);
      const t = tableName(datasetId);
      const where = buildWhere(state, view);
      const rows = await queryRows<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${ident(t)} WHERE ${where}`,
      );
      return Number(rows[0]?.n ?? 0);
    },

    async fetchGroupBy(datasetId, params, view) {
      const state = await ensureLoaded(datasetId);
      const t = tableName(datasetId);
      const col = resolveColumn(state, params.group);
      if (!col) return [];
      const where = view ? buildWhere(state, view) : "1=1";
      const agg =
        params.fn === "count"
          ? "NULL"
          : params.fn === "sum"
            ? `SUM(${ident(params.agg ?? "")})`
            : `AVG(${ident(params.agg ?? "")})`;
      const rows = await queryRows<{ label: string; value: number | null; count: number }>(
        `SELECT CAST(${ident(col.key)} AS VARCHAR) AS label, ${agg} AS value, COUNT(*) AS count
         FROM ${ident(t)}
         WHERE ${where}
         GROUP BY ${ident(col.key)}
         HAVING COUNT(*) >= ${params.minCount}
         ORDER BY ${params.fn === "count" ? "count" : "value"} DESC
         LIMIT ${params.topN}`,
      );
      return rows;
    },

    async applyOperation(datasetId, operation, params) {
      const state = await ensureLoaded(datasetId);
      const t = tableName(datasetId);
      try {
        switch (operation) {
          case "edit_cell": {
            const rowId = Number(params.row_id);
            const key = String(params.column_key);
            const col = resolveColumn(state, key);
            if (!col) return { ok: false, error: "Column not found" };
            const before = await queryRows<{ v: unknown }>(
              `SELECT ${ident(col.key)} AS v FROM ${ident(t)} WHERE __rowno = ${rowId}`,
            );
            const oldValue = before[0]?.v ?? null;
            const value = params.new_value ?? null;
            await executeSql(
              `UPDATE ${ident(t)} SET ${ident(col.key)} = ${lit(value)} WHERE __rowno = ${rowId}`,
            );
            const op: LocalOp = {
              operation: "edit_cell",
              payload: { row_id: rowId, column_key: col.key, new_value: value },
              inverse: { row_id: rowId, column_key: col.key, new_value: oldValue },
            };
            state.undo.push(op);
            state.redo = [];
            await persistState(datasetId, state);
            return { ok: true, message: "Cell updated", affected: 1 };
          }
          case "rename_column": {
            const oldKey = String(params.old_key);
            const newKey = String(params.new_key);
            const col = resolveColumn(state, oldKey);
            if (!col) return { ok: false, error: "Column not found" };
            await executeSql(
              `ALTER TABLE ${ident(t)} RENAME COLUMN ${ident(oldKey)} TO ${ident(newKey)}`,
            );
            const oldLabel = col.label;
            col.key = newKey;
            col.label = (params.new_label as string | undefined) ?? oldLabel;
            const op: LocalOp = {
              operation: "rename_column",
              payload: { old_key: oldKey, new_key: newKey, new_label: col.label },
              inverse: { old_key: newKey, new_key: oldKey, new_label: oldLabel },
            };
            state.undo.push(op);
            state.redo = [];
            await persistState(datasetId, state);
            return { ok: true, message: "Column renamed", affected: 1 };
          }
          case "filter_rows": {
            const filters = (params.filters ?? []) as ViewState["filters"];
            if (filters.length === 0) return { ok: false, error: "No filter criteria supplied" };
            const where = buildWhere(state, { sort: null, filters });
            const removed = await queryRows<Record<string, unknown>>(
              `SELECT * FROM ${ident(t)} WHERE NOT (${where})`,
            );
            if (removed.length === 0) return { ok: false, error: "No rows match the filter", affected: 0 };
            const colsList = [state.cols.map((c) => ident(c.key)).join(", "), "__rowno"].join(", ");
            const rowsSql = removed
              .map((r) => {
                const { __rowno, ...data } = r;
                return `(${state.cols.map((c) => lit(data[c.key] ?? null)).join(", ")}, ${__rowno})`;
              })
              .join(",\n");
            await executeSql(
              `DELETE FROM ${ident(t)} WHERE NOT (${where})`,
            );
            const op: LocalOp = {
              operation: "filter_rows",
              payload: { filters, label: params.label },
              inverse: { restored_rows: rowsSql, cols: colsList },
            };
            state.undo.push(op);
            state.redo = [];
            await persistState(datasetId, state);
            return { ok: true, message: `${removed.length} rows filtered`, affected: removed.length };
          }
          case "dedupe": {
            const cols = (params.columns ?? []) as string[];
            const groupKeys = (cols.length > 0 ? cols : state.cols).map(
              (key) => resolveColumn(state, String(key))?.key ?? String(key),
            );
            const keysSql = groupKeys.map((k) => ident(k)).join(", ");
            const dupes = await queryRows<{ rowno: number }>(
              `SELECT earliest.__rowno AS rowno
               FROM ${ident(t)} earliest
               JOIN (SELECT ${keysSql}, MIN(__rowno) AS keep
                     FROM ${ident(t)}
                     GROUP BY ${keysSql}
                     HAVING COUNT(*) > 1) d
                 ON d.keep <> earliest.__rowno
                 AND ${groupKeys.map((k) => `earliest.${ident(k)} IS NOT DISTINCT FROM d.${ident(k)}`).join(" AND ")}
               ORDER BY earliest.__rowno DESC`,
            );
            if (dupes.length === 0) return { ok: false, error: "No duplicate rows found", affected: 0 };
            const dupRows = await queryRows<Record<string, unknown>>(
              `SELECT * FROM ${ident(t)} WHERE __rowno IN (${dupes.map((d) => d.rowno).join(", ")}) ORDER BY __rowno`,
            );
            const rowsSql = dupRows
              .map((r) => {
                const { __rowno, ...data } = r;
                return `(${state.cols.map((c) => lit(data[c.key] ?? null)).join(", ")}, ${__rowno})`;
              })
              .join(",\n");
            const colsList = [state.cols.map((c) => ident(c.key)).join(", "), "__rowno"].join(", ");
            await executeSql(
              `DELETE FROM ${ident(t)} WHERE __rowno IN (${dupes.map((d) => d.rowno).join(", ")})`,
            );
            const op: LocalOp = {
              operation: "dedupe",
              payload: { row_nos: dupes.map((d) => d.rowno), cols: groupKeys, label: params.label },
              inverse: { restored_rows: rowsSql, cols: colsList },
            };
            state.undo.push(op);
            state.redo = [];
            await persistState(datasetId, state);
            return { ok: true, message: `${dupes.length} duplicates removed`, affected: dupes.length };
          }
          case "add_column": {
            return addColumnLocal(datasetId, state, params as unknown as AddColumnParams);
          }
          default:
            return { ok: false, error: `Unsupported operation "${operation}" locally yet (Phase 3: ${operation} on grid).` };
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Operation failed" };
      }
    },

    async undoOperation(datasetId) {
      const state = await ensureLoaded(datasetId);
      const op = state.undo.pop();
      if (!op) return { ok: false, error: "Nothing to undo" };
      try {
        await applyInverse(datasetId, state, op);
        state.redo.push(op);
        await persistState(datasetId, state);
        return { ok: true, message: "Undid operation" };
      } catch (e) {
        state.undo.push(op);
        return { ok: false, error: e instanceof Error ? e.message : "Undo failed" };
      }
    },

    async redoOperation(datasetId) {
      const state = await ensureLoaded(datasetId);
      const op = state.redo.pop();
      if (!op) return { ok: false, error: "Nothing to redo" };
      try {
        await applyPayload(datasetId, state, op);
        state.undo.push(op);
        await persistState(datasetId, state);
        return { ok: true, message: "Redid operation" };
      } catch (e) {
        state.redo.push(op);
        return { ok: false, error: e instanceof Error ? e.message : "Redo failed" };
      }
    },

    async addColumn(datasetId, params) {
      const state = await ensureLoaded(datasetId);
      return addColumnLocal(datasetId, state, params);
    },

    async computeStats(datasetId, columns) {
      const state = await ensureLoaded(datasetId);
      const t = tableName(datasetId);
      const now = new Date().toISOString();
      const out: ColumnStats[] = [];
      for (const col of columns) {
        const resolved = resolveColumn(state, col.key);
        if (!resolved) continue;
        const q = ident(resolved.key);
        if (resolved.type === "numeric") {
          const rows = await queryRows<{
            distinct_count: number;
            null_count: number;
            min: number | null;
            max: number | null;
            avg: number | null;
            sum: number | null;
          }>(
            `SELECT COUNT(DISTINCT CAST(${q} AS VARCHAR)) AS distinct_count,
                    COUNT(*) FILTER (WHERE ${q} IS NULL OR TRY_CAST(${q} AS VARCHAR) = '') AS null_count,
                    MIN(CAST(${q} AS DOUBLE)) AS min,
                    MAX(CAST(${q} AS DOUBLE)) AS max,
                    AVG(CAST(${q} AS DOUBLE)) AS avg,
                    SUM(CAST(${q} AS DOUBLE)) AS sum
             FROM ${ident(t)}`,
          );
          const r = rows[0];
          out.push({
            dataset_id: datasetId,
            column_key: resolved.key,
            min: r?.min ?? null,
            max: r?.max ?? null,
            avg: r?.avg ?? null,
            sum: r?.sum ?? null,
            distinct_count: Number(r?.distinct_count ?? 0),
            null_count: Number(r?.null_count ?? 0),
            invalid_count: 0,
            computed_at: now,
          });
        } else {
          const rows = await queryRows<{ distinct_count: number; null_count: number }>(
            `SELECT COUNT(DISTINCT CAST(${q} AS VARCHAR)) AS distinct_count,
                    COUNT(*) FILTER (WHERE ${q} IS NULL OR TRY_CAST(${q} AS VARCHAR) = '') AS null_count
             FROM ${ident(t)}`,
          );
          const r = rows[0];
          out.push({
            dataset_id: datasetId,
            column_key: resolved.key,
            min: null,
            max: null,
            avg: null,
            sum: null,
            distinct_count: Number(r?.distinct_count ?? 0),
            null_count: Number(r?.null_count ?? 0),
            invalid_count: 0,
            computed_at: now,
          });
        }
      }
      return out;
    },
  };
}

async function applyInverse(datasetId: string, state: LoadedDataset, op: LocalOp): Promise<void> {
  const t = tableName(datasetId);
  switch (op.operation) {
    case "edit_cell":
      await executeSql(
        `UPDATE ${ident(t)} SET ${ident(String(op.inverse.column_key))} = ${lit(op.inverse.new_value)} WHERE __rowno = ${Number(op.inverse.row_id)}`,
      );
      break;
    case "rename_column":
      await executeSql(
        `ALTER TABLE ${ident(t)} RENAME COLUMN ${ident(String(op.inverse.old_key))} TO ${ident(String(op.inverse.new_key))}`,
      );
      {
        const col = resolveColumn(state, String(op.inverse.new_key));
        if (col) {
          const label = String(op.inverse.new_label ?? "");
          col.key = String(op.inverse.new_key);
          col.label = label || col.label;
        }
      }
      break;
    case "filter_rows": {
      const restored = String(op.inverse.restored_rows);
      if (restored) {
        await executeSql(
          `INSERT INTO ${ident(t)} (${(op.inverse.cols as string) ?? String(state.cols.map((c) => ident(c.key)).join(", ")) + ", __rowno"}) VALUES ${restored}`,
        );
      }
      break;
    }
    case "dedupe": {
      const restored = String(op.inverse.restored_rows);
      if (restored) {
        await executeSql(
          `INSERT INTO ${ident(t)} (${(op.inverse.cols as string) ?? String(state.cols.map((c) => ident(c.key)).join(", ")) + ", __rowno"}) VALUES ${restored}`,
        );
      }
      break;
    }
    case "add_column": {
      const key = String(op.inverse.column_key);
      const idx = state.cols.findIndex((c) => c.key === key);
      if (idx >= 0) state.cols.splice(idx, 1);
      await executeSql(`ALTER TABLE ${ident(t)} DROP COLUMN ${ident(key)}`);
      break;
    }
  }
}

async function applyPayload(datasetId: string, state: LoadedDataset, op: LocalOp): Promise<void> {
  const t = tableName(datasetId);
  switch (op.operation) {
    case "edit_cell":
      await executeSql(
        `UPDATE ${ident(t)} SET ${ident(String(op.payload.column_key))} = ${lit(op.payload.new_value)} WHERE __rowno = ${Number(op.payload.row_id)}`,
      );
      break;
    case "rename_column":
      await executeSql(
        `ALTER TABLE ${ident(t)} RENAME COLUMN ${ident(String(op.payload.old_key))} TO ${ident(String(op.payload.new_key))}`,
      );
      {
        const col = resolveColumn(state, String(op.payload.new_key));
        if (col) {
          col.key = String(op.payload.new_key);
          col.label = (op.payload.new_label as string | undefined) ?? col.label;
        }
      }
      break;
    case "filter_rows": {
      const filters = (op.payload.filters ?? []) as ViewState["filters"];
      const where = buildWhere(state, { sort: null, filters });
      await executeSql(`DELETE FROM ${ident(t)} WHERE NOT (${where})`);
      break;
    }
    case "dedupe": {
      const rowNos = (op.payload.row_nos ?? []) as number[];
      if (rowNos.length > 0) {
        await executeSql(
          `DELETE FROM ${ident(t)} WHERE __rowno IN (${rowNos.join(", ")})`,
        );
      }
      break;
    }
    case "add_column": {
      await applyAddColumnSql(datasetId, state, op.payload as unknown as AddColumnParams);
      break;
    }
  }
}

async function applyAddColumnSql(
  datasetId: string,
  state: LoadedDataset,
  params: AddColumnParams,
  colType?: ColumnDef["type"],
): Promise<void> {
  const t = tableName(datasetId);
  const key = params.key ?? makeColumnKey(params.label);
  const type: ColumnDef["type"] = colType ?? normalizeColumnType(params.type);
  await executeSql(
    `ALTER TABLE ${ident(t)} ADD COLUMN ${ident(key)} ${DDB_TYPE[type] ?? "VARCHAR"}`,
  );
  const formula = typeof params.formula === "string" ? params.formula.trim() : "";
  if (formula) {
    const expr = compileFormula(state, formula);
    await executeSql(`UPDATE ${ident(t)} SET ${ident(key)} = (${expr})`);
  }
  if (!state.cols.some((c) => c.key === key)) {
    state.cols.push({ key, label: params.label, type });
  }
}

/** Whitelisted arithmetic formula → DuckDB expression. Only known column
 *  identifiers, numeric literals and + - * / ( ) are accepted — anything
 *  else (functions, string literals, keywords) is rejected up front. */
export function compileFormula(state: LoadedDataset, formula: string): string {
  const known = new Map<string, string>();
  for (const c of state.cols) {
    known.set(c.key.toLowerCase(), c.key);
    known.set(c.label.toLowerCase(), c.key);
  }
  const tokens = formula.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[+\-*/()]|\s+/g);
  if (!tokens) throw new Error("Formula is empty");
  const out: string[] = [];
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) continue;
    if (/^[+\-*/()]$/.test(tok)) {
      out.push(tok);
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      out.push(tok);
      continue;
    }
    const resolved = known.get(tok.toLowerCase());
    if (!resolved) {
      throw new Error(`Unknown column "${tok}" in formula`);
    }
    out.push(ident(resolved));
  }
  if (out.length === 0) throw new Error("Formula is empty");
  return out.join(" ");
}

function makeColumnKey(label: string): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return base || "column";
}

/** AddColumnParams.type uses "text"; ColumnDef uses "string". Normalize. */
export function normalizeColumnType(t: AddColumnParams["type"]): ColumnDef["type"] {
  return t === "text" ? "string" : (t ?? "numeric");
}

async function addColumnLocal(
  datasetId: string,
  state: LoadedDataset,
  params: AddColumnParams,
): Promise<OpResult> {
  if (!params.label || !params.label.trim()) return { ok: false, error: "Missing column label" };
  const key = params.key ?? makeColumnKey(params.label);
  if (!key) return { ok: false, error: "Missing column key" };
  if (state.cols.some((c) => c.key === key || c.label === params.label.trim())) {
    return { ok: false, error: "Column name already in use" };
  }
  const type = normalizeColumnType(params.type);
  const formula = typeof params.formula === "string" ? params.formula.trim() : "";
  try {
    await applyAddColumnSql(datasetId, state, { ...params, key: params.key ?? key }, type);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add column" };
  }
  const op: LocalOp = {
    operation: "add_column",
    payload: { ...params, key },
    inverse: { column_key: key },
  };
  state.undo.push(op);
  state.redo = [];
  await persistState(datasetId, state);
  return {
    ok: true,
    message: formula ? `Column "${params.label}" added with formula` : `Column "${params.label}" added`,
    affected: 1,
  };
}