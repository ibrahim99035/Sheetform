import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ReportStatus = "draft" | "published" | "revoked";
export type ItemVisibility = "org" | "branch" | "restricted";
export type ComponentKind = "text" | "chart" | "table" | "insight";
export type DeliveryStatus = "queued" | "processing" | "delivered" | "failed" | "skipped";
export type DeliveryKind = "email" | "whatsapp";

export interface ReportRow {
  id: string;
  organization_id: string;
  branch_id: string | null;
  title: string;
  summary: string | null;
  status: ReportStatus;
  created_by: string;
  published_at: string | null;
  revised_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportComponentRow {
  id: string;
  report_id: string;
  kind: ComponentKind;
  title: string | null;
  body: Record<string, unknown> | null;
  visibility: ItemVisibility;
  branch_ids: string[];
  sort_order: number;
}

export interface ReportItemRow {
  id: string;
  report_id: string;
  visibility: ItemVisibility;
  branch_ids: string[];
  title: string | null;
  body: Record<string, unknown> | null;
  sort_order: number;
}

export interface ReportApplicationRow {
  application_id: string;
  title: string;
  status: string;
}

export interface DeliveryRow {
  id: number;
  report_id: string;
  kind: DeliveryKind;
  to_address: string;
  subject: string | null;
  status: DeliveryStatus;
  attempt_count: number;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface OrganizationOption {
  id: string;
  name: string;
  status: string;
}

export interface BranchOption {
  id: string;
  organization_id: string;
  name: string;
}

export interface ReportListItem extends ReportRow {
  org_name: string;
  branch_name: string | null;
  delivery_counts: { delivered: number; failed: number; queued: number } | null;
}

export interface ReportDetail {
  report: ReportRow & { org_name: string; branch_name: string | null };
  components: ReportComponentRow[];
  items: ReportItemRow[];
  applications: ReportApplicationRow[];
  deliveries: DeliveryRow[];
}

const DELIVERY_TALLY = "queued,processing,delivered,failed,skipped";

export async function getOrganizations(): Promise<OrganizationOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, status")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as OrganizationOption[];
}

export async function getBranches(): Promise<BranchOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .select("id, organization_id, name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchOption[];
}

export interface ApplicationWithOrg {
  application_id: string;
  organization_id: string;
  title: string;
  status: string;
}

export async function getApplications(): Promise<ApplicationWithOrg[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("id, organization_id, title, status")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    id: string;
    organization_id: string;
    title: string;
    status: string;
  }[]).map((a) => ({
    application_id: a.id,
    organization_id: a.organization_id,
    title: a.title,
    status: a.status,
  }));
}

export async function listReports(): Promise<ReportListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const orgIds = [...new Set(data.map((r) => r.organization_id))];
  const branchIds = [...new Set(data.map((r) => r.branch_id).filter(Boolean))] as string[];

  const [{ data: orgs }, { data: branches }, { data: deliveries }] = await Promise.all([
    supabase.from("organizations").select("id, name").in("id", orgIds),
    branchIds.length > 0
      ? supabase.from("branches").select("id, name").in("id", branchIds)
      : Promise.resolve({ data: [] }),
    supabase.from("deliveries").select("report_id, status"),
  ]);

  const orgName = new Map((orgs ?? []).map((o) => [o.id, (o as { name: string }).name]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, (b as { name: string }).name]));
  const tally = new Map<string, { delivered: number; failed: number; queued: number }>();
  for (const d of (deliveries ?? []) as { report_id: string; status: string }[]) {
    const cur = tally.get(d.report_id) ?? { delivered: 0, failed: 0, queued: 0 };
    if (d.status === "delivered") cur.delivered++;
    else if (d.status === "failed") cur.failed++;
    else if (d.status === "queued" || d.status === "processing") cur.queued++;
    tally.set(d.report_id, cur);
  }

  return (data as ReportRow[]).map((r) => ({
    ...r,
    org_name: orgName.get(r.organization_id) ?? "—",
    branch_name: r.branch_id ? branchName.get(r.branch_id) ?? null : null,
    delivery_counts: tally.get(r.id) ?? null,
  }));
}

export const getReportDetail = cache(async (reportId: string): Promise<ReportDetail | null> => {
  const supabase = await createClient();
  const { data: report, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!report) return null;

  const [orgRes, branchRes, compRes, itemRes, appRes, delRes] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", report.organization_id).maybeSingle(),
    report.branch_id
      ? supabase.from("branches").select("name").eq("id", report.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("report_components").select("*").eq("report_id", reportId).order("sort_order"),
    supabase.from("report_items").select("*").eq("report_id", reportId).order("sort_order"),
    supabase.from("report_applications").select("application_id").eq("report_id", reportId),
    supabase.from("deliveries").select("*").eq("report_id", reportId).order("created_at", { ascending: false }),
  ]);

  let applications: ReportApplicationRow[] = [];
  const appIds = (appRes.data ?? []).map((a) => (a as { application_id: string }).application_id);
  if (appIds.length > 0) {
    const { data: apps } = await supabase
      .from("applications")
      .select("id, title, status")
      .in("id", appIds);
    const byId = new Map((apps ?? []).map((a) => [(a as { id: string }).id, a]));
    applications = (appIds
      .map((id) => {
        const a = byId.get(id) as { title: string; status: string } | undefined;
        return a ? { application_id: id, title: a.title ?? "Untitled", status: a.status } : null;
      })
      .filter(Boolean) as ReportApplicationRow[]);
  }

  const branchName = (branchRes.data as { name: string } | null)?.name ?? null;

  return {
    report: {
      ...report,
      org_name: (orgRes.data as { name: string } | null)?.name ?? "—",
      branch_name: branchName,
    },
    components: (compRes.data ?? []) as ReportComponentRow[],
    items: (itemRes.data ?? []) as ReportItemRow[],
    applications,
    deliveries: (delRes.data ?? []) as DeliveryRow[],
  };
});

export const getReportApps = cache(async (reportId: string): Promise<ReportApplicationRow[] | null> => {
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return null;
  const { data: appRes } = await supabase
    .from("report_applications")
    .select("application_id")
    .eq("report_id", reportId);
  const appIds = (appRes ?? []).map((a) => (a as { application_id: string }).application_id);
  if (appIds.length === 0) return [];
  const { data: apps } = await supabase.from("applications").select("id, title, status").in("id", appIds);
  const byId = new Map((apps ?? []).map((a) => [(a as { id: string }).id, a]));
  return appIds
    .map((id) => {
      const a = byId.get(id) as { title: string; status: string } | undefined;
      return a ? { application_id: id, title: a.title ?? "Untitled", status: a.status } : null;
    })
    .filter(Boolean) as ReportApplicationRow[];
});

export { DELIVERY_TALLY };