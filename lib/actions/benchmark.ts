"use server";

import { createClient } from "@/lib/supabase/server";
import { buildSuite, projectRows, resolveRoleKey } from "@/lib/analysis/modules";
import { fetchAllRows } from "@/lib/dataset-rows";
import { buildBenchmarkPayload, categoryMargins, coerceNumeric } from "@/lib/benchmark-sync";
import type { ColumnDef, ColumnType } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BenchmarkActionResult =
  | { ok: true; skipped: boolean; synced?: number; reason?: string }
  | { ok: false; error: string };

export interface BenchmarkOptInState {
  enabled: boolean;
  region: string | null;
  /** org_profile.region, offered as the default region in the toggle UI. */
  orgRegion: string | null;
  tenant: "org" | "owner";
}

async function requireUser(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

type Tenant = { orgId: string } | { ownerId: string };

/**
 * Resolve the benchmarking tenant for a dataset: org when the dataset is
 * linked to an application (org workflow), otherwise the owning user
 * (operator / superadmin uploads).
 */
async function resolveTenant(
  supabase: SupabaseClient,
  datasetId: string,
  userId: string,
): Promise<Tenant> {
  const { data: file } = await supabase
    .from("application_files")
    .select("application_id")
    .eq("dataset_id", datasetId)
    .maybeSingle();
  if (file?.application_id) {
    const { data: app } = await supabase
      .from("applications")
      .select("organization_id")
      .eq("id", file.application_id)
      .maybeSingle();
    if (app?.organization_id) return { orgId: app.organization_id };
  }
  return { ownerId: userId };
}

async function readOptIn(
  supabase: SupabaseClient,
  tenant: Tenant,
): Promise<{ enabled: boolean; region: string | null } | null> {
  const query =
    "orgId" in tenant
      ? supabase
          .from("benchmark_opt_in")
          .select("enabled, region")
          .eq("organization_id", tenant.orgId)
          .maybeSingle()
      : supabase
          .from("benchmark_opt_in")
          .select("enabled, region")
          .eq("owner_id", tenant.ownerId)
          .maybeSingle();
  const { data } = await query;
  if (!data) return null;
  return { enabled: Boolean(data.enabled), region: data.region ?? null };
}

function normalizeColumnDefs(defs: ColumnDef[]): ColumnDef[] {
  return defs.map((c) => ({
    key: c.key,
    label: c.label,
    type: (["string", "numeric", "date", "boolean"].includes(c.type) ? c.type : "string") as ColumnType,
    ...(c.role ? { role: c.role } : {}),
    ...(c.role_confidence ? { role_confidence: c.role_confidence } : {}),
  }));
}

/** Current opt-in state + org default region for the Benchmark card toggle. */
export async function getBenchmarkOptIn(
  datasetId: string,
): Promise<{ ok: true; state: BenchmarkOptInState } | { ok: false; error: string }> {
  const supabase = await createClient();
  try {
    const user = await requireUser(supabase);
    const tenant = await resolveTenant(supabase, datasetId, user.id);
    const opt = await readOptIn(supabase, tenant);
    let orgRegion: string | null = null;
    if ("orgId" in tenant) {
      const { data: profile } = await supabase
        .from("org_profile")
        .select("region")
        .eq("organization_id", tenant.orgId)
        .maybeSingle();
      orgRegion = profile?.region ?? null;
    }
    return {
      ok: true,
      state: {
        enabled: opt?.enabled ?? false,
        region: opt?.region ?? null,
        orgRegion,
        tenant: "orgId" in tenant ? "org" : "owner",
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read benchmark opt-in." };
  }
}

/** Persist the opt-in toggle (owner/manager-guarded RPC). */
export async function setBenchmarkOptIn(
  datasetId: string,
  opts: { enabled: boolean; region?: string | null },
): Promise<BenchmarkActionResult> {
  const supabase = await createClient();
  try {
    const user = await requireUser(supabase);
    const tenant = await resolveTenant(supabase, datasetId, user.id);
    const { error } = await supabase.rpc("set_benchmark_opt_in", {
      p_enabled: opts.enabled,
      p_region: opts.region ?? null,
      ...("orgId" in tenant ? { p_org_id: tenant.orgId } : { p_owner_id: tenant.ownerId }),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update benchmark opt-in." };
  }
}

/**
 * Upload the KB-scale aggregates for a dataset. Automatic no-op when the
 * tenant has not opted in. Recomputes the exact rollups the Benchmark card
 * renders, so the uplink always matches what was displayed.
 */
export async function syncBenchmarkAggregates(
  datasetId: string,
): Promise<BenchmarkActionResult> {
  const supabase = await createClient();
  try {
    const user = await requireUser(supabase);

    const { data: dataset, error: datasetErr } = await supabase
      .from("datasets")
      .select("id, name, status, column_defs")
      .eq("id", datasetId)
      .maybeSingle();
    if (datasetErr) return { ok: false, error: datasetErr.message };
    if (!dataset) return { ok: false, error: "Dataset not found" };
    if (dataset.status !== "ready") {
      return { ok: false, error: `Dataset is ${dataset.status}; only ready datasets can be analyzed.` };
    }

    const tenant = await resolveTenant(supabase, datasetId, user.id);
    const opt = await readOptIn(supabase, tenant);
    if (!opt?.enabled) {
      return { ok: true, skipped: true, reason: "Benchmarking is not enabled for this dataset." };
    }

    const rows = await fetchAllRows(supabase, datasetId);
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: "Dataset has no rows to aggregate." };
    }

    const columnDefs = normalizeColumnDefs((dataset.column_defs ?? []) as ColumnDef[]);
    const suite = buildSuite(columnDefs, rows, {});
    const benchmark = suite.modules.benchmark;
    if (!benchmark.available) {
      return { ok: true, skipped: true, reason: benchmark.reason };
    }

    const costKey = resolveRoleKey(columnDefs, "cost", {});
    const hasCost = costKey != null;
    const projected = projectRows(columnDefs, rows, {});
    const margins = categoryMargins(
      projected.sales.map((l) => ({
        category: l.category,
        amount: l.amount,
        cost: hasCost && costKey ? coerceNumeric(l.raw[costKey]) : undefined,
      })),
      hasCost,
    );

    const payload = buildBenchmarkPayload({
      daily: benchmark.result.daily,
      categories: benchmark.result.categories,
      margins,
    });

    const { error } = await supabase.rpc("upsert_benchmark_aggregates", {
      p_payload: payload,
      ...("orgId" in tenant ? { p_org_id: tenant.orgId } : { p_owner_id: tenant.ownerId }),
    });
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      skipped: false,
      synced: payload.days.length + payload.categories.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Benchmark sync failed" };
  }
}