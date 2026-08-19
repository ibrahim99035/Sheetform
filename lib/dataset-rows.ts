import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 10000;

/**
 * Fetch every non-deleted row of a dataset through the dataset RPC (≤10k
 * rows per page, security-invoker scoped). Returns the raw `{ data }` jsonb
 * field of each row. Shared by the deterministic analytics and benchmarking
 * server actions so both read the exact same projection.
 */
export async function fetchAllRows(
  supabase: SupabaseClient,
  datasetId: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc("get_dataset_rows", {
      p_dataset_id: datasetId,
      p_view: { filters: [] },
      p_page_size: PAGE_SIZE,
      p_page_offset: offset,
    });
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { data: Record<string, unknown> }[];
    if (batch.length === 0) break;
    rows.push(...batch.map((r) => r.data));
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}