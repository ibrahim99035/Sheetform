import type { SupabaseClient } from "@supabase/supabase-js";
import type { ColumnDef } from "@/lib/types";
import { getDuckDB } from "@/lib/db/duckdb";
import { downloadBlob, loadDataset, persistDataset } from "@/lib/db/opfs";
import {
  ensureTableLoaded,
  forgetLocalDataset,
  ident,
  sanitizeId,
  tableName,
} from "@/lib/datastore";

/**
 * Local-first backups & sync (STEP 4 — Plan Phase 6).
 *
 * OPFS is durability for the current device only — it can be evicted by the
 * browser at any time. So exporting a portable copy is first-class UX:
 *  · Parquet backup via DuckDB `COPY ... (FORMAT PARQUET)` downloaded locally
 *  · Optional encrypted-at-rest parquet sync to a per-tenant private Storage
 *    bucket (RLS), for restoring on another device.
 */

const BACKUP_BUCKET = "dataset-backups";

function ownerPath(ownerId: string, datasetId: string): string {
  return `${ownerId}/${sanitizeId(datasetId)}`;
}

/** Real .parquet bytes of the local DuckDB table (current rows, incl. edits). */
export async function exportLocalParquet(
  datasetId: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  try {
    const { connection, db } = await getDuckDB();
    const state = await ensureTableLoaded(datasetId);
    const t = tableName(datasetId);
    const colsList = state.cols.map((c) => ident(c.key)).join(", ");
    const out = `/backup_${sanitizeId(datasetId)}.parquet`;
    await connection.query(
      `COPY (SELECT ${colsList} FROM ${t} ORDER BY __rowno) TO '${out}' (FORMAT PARQUET)`,
    );
    const bytes = await db.copyFileToBuffer(out);
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parquet export failed" };
  }
}

export function downloadParquetBackup(
  datasetId: string,
  fileName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return exportLocalParquet(datasetId).then((res) => {
    if (!res.ok) return res;
    const blob = new Blob([res.bytes as unknown as BlobPart], {
      type: "application/vnd.apache.parquet",
    });
    downloadBlob(fileName, blob);
    return { ok: true };
  });
}

// ---- cloud sync (per-tenant private bucket) ----

export async function uploadParquetBackup(
  supabase: SupabaseClient,
  datasetId: string,
  fileName: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const bytes = await exportLocalParquet(datasetId);
  if (!bytes.ok) return bytes;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const path = `${ownerPath(user.id, datasetId)}/${fileName}`;
  const blob = new Blob([bytes.bytes as unknown as BlobPart], {
    type: "application/vnd.apache.parquet",
  });
  const { error } = await supabase.storage.from(BACKUP_BUCKET).upload(path, blob, {
    contentType: "application/vnd.apache.parquet",
    upsert: true,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

export interface ParquetBackupInfo {
  name: string;
  size: number;
  createdAt: string;
  id: string | null;
}

export async function listParquetBackups(
  supabase: SupabaseClient,
  datasetId: string,
): Promise<{ ok: true; backups: ParquetBackupInfo[] } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const prefix = ownerPath(user.id, datasetId);
  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list(prefix, {
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    backups: (data ?? [])
      .filter((f) => f.name.endsWith(".parquet"))
      .map((f) => ({
        id: f.id,
        name: f.name,
        size: f.metadata?.size ?? 0,
        createdAt: f.created_at ?? "",
      })),
  };
}

/** Restore the latest cloud parquet into the local OPFS data plane. */
export async function restoreLatestBackup(
  supabase: SupabaseClient,
  datasetId: string,
  columns: ColumnDef[],
): Promise<{ ok: true; rowCount: number } | { ok: false; error: string }> {
  const list = await listParquetBackups(supabase, datasetId);
  if (!list.ok) return list;
  if (list.backups.length === 0) return { ok: false, error: "No cloud backups found" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const path = `${ownerPath(user.id, datasetId)}/${list.backups[0].name}`;
  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).download(path);
  if (error) return { ok: false, error: error.message };
  return restoreFromParquet(datasetId, new Uint8Array(await data.arrayBuffer()), columns);
}

/** Re-ingest a parquet buffer into DuckDB + OPFS, replacing the local snapshot. */
export async function restoreFromParquet(
  datasetId: string,
  bytes: Uint8Array,
  columns: ColumnDef[],
): Promise<{ ok: true; rowCount: number } | { ok: false; error: string }> {
  try {
    const { db, connection } = await getDuckDB();
    const handle = `restore_${sanitizeId(datasetId)}.parquet`;
    const { DuckDBDataProtocol } = await import("@duckdb/duckdb-wasm");
    await db.registerFileHandle(handle, bytes, DuckDBDataProtocol.BROWSER_FILEREADER, true);
    const t = tableName(datasetId);
    const colsList = columns.map((c) => `"${c.key.replace(/"/g, '""')}"`).join(", ");
    const arrow = await connection.query(
      `SELECT ${colsList} FROM read_parquet('${handle}')`,
    );
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < arrow.numRows; i++) {
      const row = arrow.get(i);
      if (row) out.push({ ...(row.toJSON() as Record<string, unknown>) });
    }
    await db.dropFile(handle);
    const now = new Date().toISOString();
    await persistDataset(datasetId, {
      columnDefs: columns,
      rows: out,
      sourceFile: null,
      importedAt: now,
      updatedAt: now,
    });
    forgetLocalDataset(datasetId);
    return { ok: true, rowCount: out.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Restore failed" };
  }
}

/** Export the OPFS snapshot as a portable JSON backup file. */
export async function downloadLocalJsonBackup(
  datasetId: string,
  fileName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const snap = await loadDataset(datasetId);
  if (!snap) return { ok: false, error: "No local snapshot to export" };
  downloadBlob(fileName, JSON.stringify(snap, null, 2));
  return { ok: true };
}

/** Restore OPFS from an uploaded JSON snapshot file (e.g. from another device). */
export async function restoreFromJsonFile(
  datasetId: string,
  file: File,
): Promise<{ ok: true; rowCount: number } | { ok: false; error: string }> {
  const text = await file.text();
  let snap: Awaited<ReturnType<typeof loadDataset>>;
  try {
    snap = JSON.parse(text) as Awaited<ReturnType<typeof loadDataset>>;
  } catch {
    return { ok: false, error: "Not a valid JSON backup" };
  }
  if (!snap || !Array.isArray(snap.rows) || !Array.isArray(snap.columnDefs)) {
    return { ok: false, error: "Backup file is missing rows or columns" };
  }
  const now = new Date().toISOString();
  await persistDataset(datasetId, {
    columnDefs: snap.columnDefs,
    rows: snap.rows,
    sourceFile: null,
    importedAt: now,
    updatedAt: now,
  });
  forgetLocalDataset(datasetId);
  return { ok: true, rowCount: snap.rows.length };
}