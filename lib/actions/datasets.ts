"use server";

import { STORAGE_BUCKET } from "@/lib/constants";
import { makeUniqueKeys } from "@/lib/coerce";
import { inspectFile } from "@/lib/inspect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ColumnDef, ColumnType } from "@/lib/types";

export interface CreateDatasetInput {
  storagePath: string;
  fileName: string;
  sheetName: string;
  columns: { label: string; type: ColumnType }[];
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
