"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ColumnType } from "@/lib/types";

export interface ApplicationFileInput {
  fileName: string;
  storagePath: string;
  sheetName: string | null;
  columns: { label: string; type: ColumnType }[];
  templateCode: string | null;
}

export interface SubmitApplicationInput {
  orgId: string;
  branchId: string | null;
  title: string;
  note: string | null;
  files: ApplicationFileInput[];
}

export type ApplicationActionResult = { ok: true; applicationId: string } | { ok: false; error: string };

function baseName(fileName: string): string {
  const base = fileName.replace(/\.[^/.]+$/, "");
  return base || fileName;
}

export async function submitApplication(
  input: SubmitApplicationInput,
): Promise<ApplicationActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  if (input.files.length === 0) {
    return { ok: false, error: "Add at least one file to the application." };
  }
  for (const f of input.files) {
    if (!f.storagePath.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Invalid storage path" };
    }
  }

  const first = input.files[0];

  // The first file creates the application. submit_application names the
  // dataset after the caller's title, so we pass the file's base name and
  // then rename the application to the real title + note.
  const { data: created, error: submitError } = await supabase.rpc("submit_application", {
    p_org_id: input.orgId,
    p_title: baseName(first.fileName),
    p_original_filename: first.fileName,
    p_storage_path: first.storagePath,
    p_column_defs: first.columns,
    p_branch_id: input.branchId,
    p_sheet_name: first.sheetName,
    p_note: null,
    p_template_code: first.templateCode,
  });

  if (submitError) {
    return { ok: false, error: submitError.message };
  }

  const row = Array.isArray(created) ? created[0] : created;
  const applicationId: string | undefined = row?.application_id;
  if (!applicationId) {
    return { ok: false, error: "Could not create the application." };
  }

  for (const f of input.files.slice(1)) {
    const { error: addError } = await supabase.rpc("add_application_file", {
      p_application_id: applicationId,
      p_original_filename: f.fileName,
      p_storage_path: f.storagePath,
      p_column_defs: f.columns,
      p_sheet_name: f.sheetName,
      p_template_code: f.templateCode,
    });
    if (addError) {
      return {
        ok: false,
        error: `Application created, but one file failed to attach: ${addError.message}`,
      };
    }
  }

  const { error: renameError } = await supabase.rpc("rename_application", {
    p_application_id: applicationId,
    p_title: input.title || baseName(first.fileName),
    p_note: input.note,
  });
  if (renameError) {
    return { ok: false, error: `Application created, but could not set its title: ${renameError.message}` };
  }

  revalidatePath("/applications");
  return { ok: true, applicationId };
}