import type { SupabaseClient } from "@supabase/supabase-js";
import type { ColumnDef, DatasetKind } from "@/lib/types";
import { fetchAllRows } from "@/lib/dataset-rows";
import {
  isOpfsAvailable,
  loadDataset,
  persistDataset,
  persistMeta,
} from "@/lib/db/opfs";

/**
 * Local-first ingestion (STEP 2 — Plan Phase 1). Pulls the dataset's rows
 * through the dataset RPC once and snapshots them into OPFS, so the
 * in-browser DuckDB engine becomes the data plane for that dataset.
 *
 * OPFS is treated as the local source of truth once ingested: re-opening the
 * dataset later is served from the snapshot (edits included) instead of
 * re-fetching from the server.
 */

const MAX_LOCAL_ROWS = 100_000;

export type LocalEngineResult =
  | { ok: true; engine: "duckdb"; cached: boolean; rowCount: number }
  | { ok: false; engine: "supabase"; error?: string };

export async function ensureLocalDataset(
  supabase: SupabaseClient,
  datasetId: string,
  columnDefs: ColumnDef[],
  fileName: string | null,
  opts?: { kind?: DatasetKind; expectedRowCount?: number },
): Promise<LocalEngineResult> {
  if (!isOpfsAvailable()) {
    return { ok: false, engine: "supabase", error: "OPFS is not available in this browser." };
  }

  const existing = await loadDataset(datasetId);
  if (existing) {
    return { ok: true, engine: "duckdb", cached: true, rowCount: existing.rows.length };
  }

  if (opts?.expectedRowCount != null && opts.expectedRowCount > MAX_LOCAL_ROWS) {
    return {
      ok: false,
      engine: "supabase",
      error: `Dataset has ${opts.expectedRowCount.toLocaleString()} rows — above the ${MAX_LOCAL_ROWS.toLocaleString()} local-mode cap.`,
    };
  }

  try {
    const rows = await fetchAllRows(supabase, datasetId);
    if (rows.length > MAX_LOCAL_ROWS) {
      return {
        ok: false,
        engine: "supabase",
        error: `Dataset has ${rows.length.toLocaleString()} rows — above the ${MAX_LOCAL_ROWS.toLocaleString()} local-mode cap.`,
      };
    }
    const now = new Date().toISOString();
    await persistDataset(datasetId, {
      columnDefs,
      rows,
      sourceFile: fileName,
      importedAt: now,
      updatedAt: now,
    });
    await persistMeta({
      id: datasetId,
      name: fileName ?? datasetId,
      kind: opts?.kind ?? "sales",
      snapshotVersion: 1,
      updatedAt: now,
    });
    return { ok: true, engine: "duckdb", cached: false, rowCount: rows.length };
  } catch (e) {
    return {
      ok: false,
      engine: "supabase",
      error: e instanceof Error ? e.message : "Local ingest failed.",
    };
  }
}
