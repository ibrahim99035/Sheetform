import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupByResult, ViewState } from "./types";

export interface RowRecord {
  row_id: number;
  row_index: number;
  data: Record<string, unknown>;
}

const PAGE_SIZE = 200;

export async function fetchRows(
  client: SupabaseClient,
  datasetId: string,
  view: ViewState,
  pageSize = PAGE_SIZE,
  offset = 0,
): Promise<RowRecord[]> {
  const { data, error } = await client.rpc("get_dataset_rows", {
    p_dataset_id: datasetId,
    p_view: view,
    p_page_size: pageSize,
    p_page_offset: offset,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as RowRecord[];
}

export async function fetchRowCount(
  client: SupabaseClient,
  datasetId: string,
  view: ViewState,
): Promise<number> {
  const { data, error } = await client.rpc("get_dataset_row_count", {
    p_dataset_id: datasetId,
    p_view: view,
  });
  if (error) throw new Error(error.message);
  return (data ?? 0) as number;
}

export interface GroupByParams {
  group: string;
  agg?: string | null;
  fn: "count" | "sum" | "avg";
  topN: number;
  minCount: number;
}

export async function fetchGroupBy(
  client: SupabaseClient,
  datasetId: string,
  params: GroupByParams,
): Promise<GroupByResult[]> {
  const { data, error } = await client.rpc("group_by", {
    p_dataset_id: datasetId,
    p_group_col: params.group,
    p_agg_col: params.agg ?? null,
    p_agg_fn: params.fn,
    p_top_n: params.topN,
    p_min_count: params.minCount,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as GroupByResult[];
}

export interface OpResult {
  ok: boolean;
  error?: string;
  message?: string;
  affected?: number;
}

export async function applyOperation(
  client: SupabaseClient,
  datasetId: string,
  operation: string,
  params: Record<string, unknown>,
): Promise<OpResult> {
  const { data, error } = await client.rpc("apply_operation", {
    p_dataset_id: datasetId,
    p_operation: operation,
    p_params: params,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false }) as OpResult;
}

export async function undoOperation(
  client: SupabaseClient,
  datasetId: string,
): Promise<OpResult> {
  const { data, error } = await client.rpc("undo_operation", {
    p_dataset_id: datasetId,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false }) as OpResult;
}

export async function redoOperation(
  client: SupabaseClient,
  datasetId: string,
): Promise<OpResult> {
  const { data, error } = await client.rpc("redo_operation", {
    p_dataset_id: datasetId,
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false }) as OpResult;
}