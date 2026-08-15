"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  ComponentKind,
  DeliveryKind,
  ItemVisibility,
} from "@/lib/reports";

export type ReportActionResult =
  | { ok: true; reportId?: string; count?: number }
  | { ok: false; error: string };

export interface PublishReportInput {
  orgId: string;
  branchId: string | null;
  title: string;
  summary: string | null;
  components: {
    kind: ComponentKind;
    title: string;
    body: unknown;
    visibility?: ItemVisibility;
    branchIds?: string[];
  }[];
  items: { visibility: ItemVisibility; branchIds: string[]; title: string; body: unknown }[];
  applicationIds: string[];
}

function mapError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return fallback;
}

export async function publishReport(input: PublishReportInput): Promise<ReportActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("publish_report", {
    p_org_id: input.orgId,
    p_branch_id: input.branchId,
    p_title: input.title,
    p_summary: input.summary,
    p_components: input.components.map((c) => ({
      kind: c.kind,
      title: c.title,
      body: c.body,
      visibility: c.visibility,
      branch_ids: c.branchIds,
    })),
    p_items: input.items.map((it) => ({
      visibility: it.visibility,
      branch_ids: it.branchIds,
      title: it.title,
      body: it.body,
    })),
    p_application_ids: input.applicationIds,
  });

  if (error) return { ok: false, error: mapError(error, "Could not publish the report.") };

  revalidatePath("/reports");
  return { ok: true, reportId: data as string };
}

export async function reviseReport(
  reportId: string,
  input: PublishReportInput,
): Promise<ReportActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("revise_report", {
    p_report_id: reportId,
    p_title: input.title,
    p_summary: input.summary,
    p_components: input.components.map((c) => ({
      kind: c.kind,
      title: c.title,
      body: c.body,
      visibility: c.visibility,
      branch_ids: c.branchIds,
    })),
    p_items: input.items.map((it) => ({
      visibility: it.visibility,
      branch_ids: it.branchIds,
      title: it.title,
      body: it.body,
    })),
    p_application_ids: input.applicationIds,
    p_branch_id: input.branchId,
  });

  if (error) return { ok: false, error: mapError(error, "Could not revise the report.") };

  revalidatePath("/reports");
  revalidatePath(`/reports/${reportId}`);
  return { ok: true, reportId: (data as string) ?? reportId };
}

export async function snapshotKpis(reportId: string, metric: string): Promise<ReportActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("snapshot_report_kpis", {
    p_report_id: reportId,
    p_metric: metric,
  });

  if (error) return { ok: false, error: mapError(error, "Could not snapshot KPIs.") };

  revalidatePath(`/reports/${reportId}`);
  return { ok: true, count: (data as number) ?? 0 };
}

export async function queueDeliveries(
  reportId: string,
  kind: DeliveryKind | null,
): Promise<ReportActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("queue_report_deliveries", {
    p_report_id: reportId,
    p_kind: kind,
  });

  if (error) return { ok: false, error: mapError(error, "Could not queue deliveries.") };

  revalidatePath(`/reports/${reportId}`);
  return { ok: true, count: (data as number) ?? 0 };
}

export async function retryDeliveries(reportId: string): Promise<ReportActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("retry_deliveries", {
    p_report_id: reportId,
  });

  if (error) return { ok: false, error: mapError(error, "Could not retry deliveries.") };

  revalidatePath("/reports");
  revalidatePath(`/reports/${reportId}`);
  return { ok: true, count: (data as number) ?? 0 };
}

export async function goToReport(reportId: string) {
  redirect(`/reports/${reportId}`);
}