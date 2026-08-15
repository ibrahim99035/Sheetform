import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext } from "@/lib/rbac";
import type { DatasetStatus } from "@/lib/types";

export type ApplicationStatus = "submitted" | "processing" | "ready" | "error" | "archived";

export interface ApplicationRow {
  id: string;
  organization_id: string;
  branch_id: string | null;
  submitted_by: string;
  title: string;
  note: string | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface ApplicationFileRow {
  id: string;
  application_id: string;
  dataset_id: string;
  original_filename: string;
  sheet_name: string | null;
  column_defs: unknown;
  created_at: string;
}

export interface ApplicationListItem extends ApplicationRow {
  org_name: string;
  branch_name: string | null;
  file_count: number;
  ready_count: number;
  error_count: number;
}

export interface ApplicationFileDetail extends ApplicationFileRow {
  dataset: {
    id: string;
    name: string;
    original_filename: string;
    status: DatasetStatus;
    row_count: number;
    template_code: string | null;
  } | null;
}

export interface ApplicationDetail {
  application: ApplicationRow & { org_name: string; branch_name: string | null };
  files: ApplicationFileDetail[];
  isOperator: boolean;
}

export const getApplicationDetail = cache(
  async (applicationId: string): Promise<ApplicationDetail | null> => {
    const supabase = await createClient();
    const { isOperator } = await loadContext();

    const { data: application } = await supabase
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();

    if (!application) return null;

    const [orgRes, branchRes, fileRes] = await Promise.all([
      supabase.from("organizations").select("name").eq("id", application.organization_id).maybeSingle(),
      application.branch_id
        ? supabase
            .from("branches")
            .select("name")
            .eq("id", application.branch_id)
            .eq("organization_id", application.organization_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("application_files")
        .select("id, application_id, dataset_id, original_filename, sheet_name, column_defs, created_at")
        .eq("application_id", applicationId)
        .order("created_at"),
    ]);

    const datasetIds = (fileRes.data ?? []).map((f) => f.dataset_id);
    let datasets: { id: string; name: string; original_filename: string; status: DatasetStatus; row_count: number; template_code: string | null }[] =
      [];
    if (datasetIds.length > 0) {
      // Dataset rows are RLS-scoped to the operator; org members simply get
      // null joins (statuses then surface from the files themselves).
      const { data } = await supabase
        .from("datasets")
        .select("id, name, original_filename, status, row_count, template_code")
        .in("id", datasetIds);
      datasets = (data ?? []) as typeof datasets;
    }
    const datasetById = new Map(datasets.map((d) => [d.id, d]));

    return {
      application: {
        ...application,
        org_name: ((orgRes.data as { name: string } | null)?.name ?? "—"),
        branch_name: (branchRes.data as { name: string } | null)?.name ?? null,
      },
      files: (fileRes.data ?? []).map((f) => ({
        ...f,
        dataset: datasetById.get(f.dataset_id) ?? null,
      })) as ApplicationFileDetail[],
      isOperator,
    };
  },
);

export const listApplications = cache(async (): Promise<ApplicationListItem[]> => {
  const supabase = await createClient();
  const roleContext = await getRoleContext();

  const query = supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: false });

  // A member only ever sees their own org (RLS also enforces this); scoping
  // avoids a cross-org join for the list view.
  const orgId = roleContext.isSuperadmin ? undefined : roleContext.orgId;
  if (orgId) query.eq("organization_id", orgId);

  const { data } = await query;
  if (!data || data.length === 0) return [];

  const orgIds = [...new Set(data.map((a) => a.organization_id))];
  const branchIds = [...new Set(data.map((a) => a.branch_id).filter(Boolean))] as string[];

  const [orgRes, branchRes, fileRes] = await Promise.all([
    supabase.from("organizations").select("id, name").in("id", orgIds),
    branchIds.length > 0
      ? supabase.from("branches").select("id, name").in("id", branchIds)
      : Promise.resolve({ data: [] }),
    // RLS scopes files to the member's org; the whole-org aggregate matches.
    supabase.from("application_files").select("application_id, dataset_id"),
  ]);

  const orgName = new Map((orgRes.data ?? []).map((o) => [o.id, o.name]));
  const branchName = new Map((branchRes.data ?? []).map((b) => [b.id, b.name]));
  const perApp = new Map<string, { f: number; ready: number; errors: number }>();
  for (const f of (fileRes.data ?? []) as { application_id: string; dataset_id: string }[]) {
    const cur = perApp.get(f.application_id) ?? { f: 0, ready: 0, errors: 0 };
    cur.f++;
    perApp.set(f.application_id, cur);
  }

  return (data as ApplicationRow[]).map((a) => {
    const tally = perApp.get(a.id) ?? { f: 0, ready: 0, errors: 0 };
    return {
      ...a,
      org_name: orgName.get(a.organization_id) ?? "—",
      branch_name: a.branch_id ? branchName.get(a.branch_id) ?? null : null,
      file_count: tally.f,
      ready_count: tally.ready,
      error_count: tally.errors,
    };
  });
});

async function loadContext() {
  // Analysis + report building read dataset rows, which are superadmin-only
  // by RLS. Everyone else gets a read-only application view.
  const roleContext = await getRoleContext();
  return { roleContext, isOperator: roleContext.isSuperadmin ? true : false };
}