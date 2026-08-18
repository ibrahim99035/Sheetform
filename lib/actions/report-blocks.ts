"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface ReportBlockContent {
  kind: "chart" | "table" | "insight" | "text";
  title: string;
  body: unknown;
  chartType: "bar" | "line" | "area" | "pie" | null;
  branchIds: string[];
}

export interface ReportBlockRow {
  id: string;
  application_id: string;
  kind: "chart" | "table" | "insight" | "text";
  title: string;
  body: Record<string, unknown> | null;
  chart_type: "bar" | "line" | "area" | "pie" | null;
  branch_ids: string[];
  sort_order: number;
  created_at: string;
}

export type ReportBlockResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

function mapError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return fallback;
}

function getUser(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  return supabase.auth.getUser().then(({ data }) => data.user?.id ?? null);
}

export async function addReportBlock(
  applicationId: string,
  block: ReportBlockContent,
): Promise<ReportBlockResult> {
  const supabase = await createClient();
  const userId = await getUser(supabase);
  if (!userId) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("add_report_block", {
    p_application_id: applicationId,
    p_kind: block.kind,
    p_title: block.title,
    p_body: block.body,
    p_chart_type: block.chartType,
    p_branch_ids: block.branchIds,
  });
  if (error) return { ok: false, error: mapError(error, "Could not add the block.") };

  revalidatePath(`/applications/${applicationId}`);
  return { ok: true, id: data as string };
}

export async function reorderReportBlocks(
  applicationId: string,
  orderedIds: string[],
): Promise<ReportBlockResult> {
  const supabase = await createClient();
  const userId = await getUser(supabase);
  if (!userId) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.rpc("reorder_report_blocks", {
    p_application_id: applicationId,
    p_ordered_ids: orderedIds,
  });
  if (error) return { ok: false, error: mapError(error, "Could not reorder blocks.") };

  revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

export async function deleteReportBlock(blockId: string): Promise<ReportBlockResult> {
  const supabase = await createClient();
  const userId = await getUser(supabase);
  if (!userId) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.rpc("delete_report_block", {
    p_block_id: blockId,
  });
  if (error) return { ok: false, error: mapError(error, "Could not delete the block.") };

  return { ok: true };
}

export type ReportBlocksResult =
  | { ok: true; blocks: ReportBlockRow[] }
  | { ok: false; error: string };

export async function getReportBlocks(
  applicationId: string,
): Promise<ReportBlockRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_blocks")
    .select("*")
    .eq("application_id", applicationId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(mapError(error, "Could not load report blocks."));
  return (data ?? []) as ReportBlockRow[];
}