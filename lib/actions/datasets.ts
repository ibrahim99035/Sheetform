"use server";

import { STORAGE_BUCKET, MAX_FILE_SIZE } from "@/lib/constants";
import { makeUniqueKeys } from "@/lib/coerce";
import { inspectFile } from "@/lib/inspect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import type { ColumnDef, ColumnType, ColumnRole, RoleConfidence } from "@/lib/types";

export interface CreateDatasetInput {
  storagePath: string;
  fileName: string;
  sheetName: string;
  columns: { label: string; type: ColumnType; role?: ColumnRole; role_confidence?: RoleConfidence }[];
  name?: string;
}

export type CreateDatasetResult =
  | { ok: true; datasetId: string }
  | { ok: false; error: string };

function baseName(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, "");
  return base || fileName;
}

export async function createDataset(
  input: CreateDatasetInput,
): Promise<CreateDatasetResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Not authenticated" };

  if (!input.storagePath.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid storage path" };
  }

  const admin = createAdminClient();

  const { data: fileBuffer, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(input.storagePath);

  if (downloadError || !fileBuffer) {
    return { ok: false, error: "Could not read the uploaded file." };
  }

  const buffer = new Uint8Array(await fileBuffer.arrayBuffer());

  if (buffer.byteLength > MAX_FILE_SIZE) {
    return { ok: false, error: "The file exceeds the 25 MB size limit." };
  }

  const inspected = inspectFile(buffer, input.fileName);

  let header: string[];
  if (inspected.decision.kind === "single") {
    header = inspected.decision.sheet.header;
  } else if (inspected.decision.kind === "auto_populated") {
    header = inspected.decision.sheet.header;
  } else if (inspected.decision.kind === "picker") {
    const chosen = inspected.decision.sheets.find((s) => s.name === input.sheetName);
    if (!chosen) {
      return { ok: false, error: "The selected sheet is not available." };
    }
    header = chosen.header;
  } else {
    return { ok: false, error: inspected.decision.message };
  }

  if (header.length === 0) {
    return { ok: false, error: "The selected sheet has no header row." };
  }

  if (input.columns.length !== header.length) {
    return { ok: false, error: "Column mismatch detected. Please re-upload the file." };
  }

  const keys = makeUniqueKeys(header);
  const columnDefs: ColumnDef[] = header.map((_, i) => ({
    key: keys[i],
    label: input.columns[i].label || header[i],
    type: input.columns[i].type,
    role: input.columns[i].role ?? undefined,
    role_confidence: input.columns[i].role_confidence ?? undefined,
  }));

  const { data: dataset, error } = await supabase
    .from("datasets")
    .insert({
      owner_id: user.id,
      name: input.name?.trim() || baseName(input.fileName),
      original_filename: input.fileName,
      storage_path: input.storagePath,
      status: "pending",
      column_defs: columnDefs,
      sheet_name: inspected.decision.kind === "picker" ? input.sheetName : undefined,
    })
    .select("id")
    .single();

  if (error || !dataset) {
    return { ok: false, error: error?.message ?? "Could not create the dataset." };
  }

  return { ok: true, datasetId: dataset.id };
}

export type RetryImportResult = { ok: true } | { ok: false; error: string };

/**
 * Operator-only recovery for a stuck/failed import.
 *
 * 1. `retry_import` (superadmin-guarded RPC) flips the dataset back to
 *    `pending` so the ingest run is eligible again.
 * 2. We re-invoke the Edge Function (same guard the DB webhook uses) so no
 *    webhook is needed for the retry.
 */
export async function retryImport(datasetId: string): Promise<RetryImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Not authenticated" };

  const admin = createAdminClient();

  const { error: rpcError } = await admin.rpc("retry_import", {
    p_dataset_id: datasetId,
  });
  if (rpcError) {
    log.warn("retry_import rejected", { datasetId, error: rpcError.message });
    return { ok: false, error: rpcError.message };
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) return { ok: false, error: "Supabase URL is not configured." };

  try {
    const res = await fetch(`${baseUrl}/functions/v1/import-dataset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.WEBHOOK_SECRET
          ? { "x-supabase-webhook-secret": process.env.WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ dataset_id: datasetId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("import re-invocation failed", {
        datasetId,
        status: res.status,
        body: text.slice(0, 200),
      });
      return { ok: false, error: `Re-invocation failed (HTTP ${res.status}).` };
    }
  } catch (err) {
    log.error("import re-invocation threw", {
      datasetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  log.info("import re-invoked", { datasetId });
  return { ok: true };
}
