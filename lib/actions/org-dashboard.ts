"use server";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getRoleContext, canAccessOrg } from "@/lib/rbac";
import { assessServiceCoverage, type ServiceCoverage } from "@/lib/analysis/services";
import type { Dataset, ColumnDef } from "@/lib/types";

export interface OrgDatasetSummary {
  id: string;
  name: string;
  original_filename: string;
  status: string;
  row_count: number;
  service_coverage: ServiceCoverage[] | null;
  data_requests: { role: string; label: string }[] | null;
}

export interface OrgDashboardData {
  organization: {
    id: string;
    name: string;
  };
  datasets: OrgDatasetSummary[];
  mergedRoleMap: Partial<Record<string, string>>;
  mergedCoverage: ServiceCoverage[];
  kpis: {
    totalDatasets: number;
    totalRows: number;
    readyDatasets: number;
    servicesReady: number;
    servicesTotal: number;
  };
}

export const getOrgDashboard = cache(
  async (orgId: string): Promise<OrgDashboardData | null> => {
    const supabase = await createClient();
    const roleCtx = await getRoleContext();

    if (!canAccessOrg(roleCtx, orgId)) return null;

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .maybeSingle();

    if (!org) return null;

    const { data: memberDatasets } = await supabase
      .from("org_members")
      .select("organization_id")
      .eq("user_id", roleCtx.userId!)
      .maybeSingle();

    const { data: applications } = await supabase
      .from("applications")
      .select("id")
      .eq("organization_id", orgId);

    const appIds = (applications ?? []).map((a) => a.id);
    let datasetIds: string[] = [];

    if (appIds.length > 0) {
      const { data: files } = await supabase
        .from("application_files")
        .select("dataset_id")
        .in("application_id", appIds);

      datasetIds = [...new Set((files ?? []).map((f) => f.dataset_id).filter(Boolean))] as string[];
    }

    let datasets: OrgDatasetSummary[] = [];
    if (datasetIds.length > 0) {
      const { data: dsRows } = await supabase
        .from("datasets")
        .select("id, name, original_filename, status, row_count, service_coverage, data_requests")
        .in("id", datasetIds);

      datasets = ((dsRows ?? []) as unknown as OrgDatasetSummary[]).map((ds) => ({
        id: ds.id,
        name: ds.name,
        original_filename: ds.original_filename,
        status: ds.status,
        row_count: ds.row_count,
        service_coverage: ds.service_coverage ?? null,
        data_requests: ds.data_requests ?? null,
      }));
    }

    const mergedRoleMap: Partial<Record<string, string>> = {};
    for (const ds of datasets) {
      if (ds.service_coverage) {
        continue;
      }
      const { data: colDefs } = await supabase
        .from("datasets")
        .select("column_defs")
        .eq("id", ds.id)
        .maybeSingle();

      if (colDefs) {
        const defs = (colDefs as { column_defs: ColumnDef[] }).column_defs;
        for (const d of defs) {
          if (d.role && !mergedRoleMap[d.role]) {
            mergedRoleMap[d.role] = d.key;
          }
        }
      }
    }

    const mergedCoverage = assessServiceCoverage(
      mergedRoleMap as Partial<Record<string, string>>,
    );

    const readyDatasets = datasets.filter((d) => d.status === "ready").length;
    const servicesReady = mergedCoverage.filter((s) => s.available).length;

    return {
      organization: { id: org.id, name: org.name },
      datasets,
      mergedRoleMap: mergedRoleMap as Partial<Record<string, string>>,
      mergedCoverage,
      kpis: {
        totalDatasets: datasets.length,
        totalRows: datasets.reduce((sum, d) => sum + d.row_count, 0),
        readyDatasets,
        servicesReady,
        servicesTotal: 9,
      },
    };
  },
);
