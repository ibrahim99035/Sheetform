"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { runAnalysis } from "@/lib/analysis";
import type {
  AnalysisReport,
  AnalysisRpcPayload,
  CompareRow,
  ConcentrationResult,
  DatasetKpis,
  QualityProfile,
  RankRow,
  RefundResult,
  Sensitivity,
  TimePoint,
} from "@/lib/analysis/types";
import type { ColumnRole } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AnalysisActionResult =
  | { ok: true; report?: AnalysisReport }
  | { ok: false; error: string };

async function requireUser(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

// Runs the full hybrid analysis for a dataset and persists the snapshot.
export async function runDatasetAnalysis(
  datasetId: string,
  opts?: { sensitivity?: Sensitivity; mode?: "auto" | "manual" },
): Promise<AnalysisActionResult> {
  const supabase = await createClient();
  try {
    await requireUser(supabase);

    const { data: dataset } = await supabase
      .from("datasets")
      .select("id, name, status, column_defs")
      .eq("id", datasetId)
      .maybeSingle();
    if (!dataset) return { ok: false, error: "Dataset not found" };
    if (dataset.status !== "ready") {
      return { ok: false, error: `Dataset is ${dataset.status}; only ready datasets can be analyzed.` };
    }

    const column_defs = ((dataset.column_defs ?? []) as { key: string; label: string; type: string }[]).map(
      (c) => ({ key: c.key, label: c.label, type: (["string", "numeric", "date", "boolean"].includes(c.type) ? c.type : "string") as "string" | "numeric" | "date" | "boolean" }),
    );
    const sensitivity = opts?.sensitivity ?? "sales_financial";
    const mode = opts?.mode ?? "auto";

    // Resolver + shared analytics RPCs run in parallel.
    const [
      rolesRes,
      qualityRes,
      kpisRes,
      tsRes,
      cmpRes,
      refundRes,
      concRes,
      topProductsRes,
      bottomProductsRes,
      topCategoriesRes,
      weekdayRes,
      hourRes,
    ] = await Promise.all([
      guardedRpc(supabase, "_sf_dataset_key_map", { p_dataset_id: datasetId }, {}),
      guardedRpc(supabase, "quality_profile", { p_dataset_id: datasetId }, { rows: 0, columns: [], flags: [] }),
      guardedRpc(supabase, "dataset_kpis", { p_dataset_id: datasetId }, {}),
      guardedRpc(supabase, "time_series", { p_dataset_id: datasetId, p_metric: "revenue", p_bucket: "month" }, []),
      guardedRpc(supabase, "compare_periods", { p_dataset_id: datasetId, p_metric: "revenue", p_bucket: "month" }, { label: null, current_value: null, prior_value: null, delta: null, delta_pct: null }),
      guardedRpc(supabase, "refund_rate", { p_dataset_id: datasetId }, { gross_revenue: null, refunds: null, refund_rows: null, refund_rate_pct: null, estimated: false }),
      guardedRpc(supabase, "concentration", { p_dataset_id: datasetId, p_n: 20 }, { available: false }),
      guardedRpc(supabase, "rank_samples", { p_dataset_id: datasetId, p_dimension: "product", p_metric: "revenue", p_n: 10, p_dir: "desc" }, []),
      guardedRpc(supabase, "rank_samples", { p_dataset_id: datasetId, p_dimension: "product", p_metric: "revenue", p_n: 5, p_dir: "asc" }, []),
      guardedRpc(supabase, "rank_samples", { p_dataset_id: datasetId, p_dimension: "category", p_metric: "revenue", p_n: 10, p_dir: "desc" }, []),
      guardedRpc(supabase, "time_pattern", { p_dataset_id: datasetId, p_granularity: "dow" }, []),
      guardedRpc(supabase, "time_pattern", { p_dataset_id: datasetId, p_granularity: "hour" }, []),
    ]);

    const kpis = kpisRes as DatasetKpis;
    const rows = typeof kpis.rows === "number" ? kpis.rows : qualityRows(qualityRes);

    const payload: AnalysisRpcPayload = {
      roles: rolesRes as Partial<Record<ColumnRole, string>>,
      quality: qualityRes as QualityProfile,
      kpis,
      timeSeries: tsRes as TimePoint[],
      comparison: cmpRes as CompareRow,
      refund: refundRes as RefundResult,
      concentration: concRes as ConcentrationResult,
      topProducts: topProductsRes as RankRow[],
      bottomProducts: bottomProductsRes as RankRow[],
      topCategories: topCategoriesRes as RankRow[],
      weekdayPattern: weekdayRes as RankRow[],
      hourPattern: hourRes as RankRow[],
      rows,
      columns: column_defs,
      sensitivity,
      mode,
    };

    const report = runAnalysis(payload, datasetId, dataset.name);

    const { error: upsertErr } = await supabase
      .from("dataset_analyses")
      .upsert(
        {
          dataset_id: datasetId,
          roles: payload.roles as unknown as Record<string, unknown>,
          report: report as unknown as Record<string, unknown>,
          markdown: report.markdown,
          sensitivity,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dataset_id" },
      );
    if (upsertErr) return { ok: false, error: upsertErr.message };

    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Analysis failed" };
  }
}

function qualityRows(q: unknown): number {
  if (q && typeof q === "object" && "rows" in q) {
    const n = (q as { rows: unknown }).rows;
    if (typeof n === "number") return n;
  }
  return 0;
}

// Returns data on success or the fallback when the RPC raises (e.g. missing
// role for a dimension/metric), mirroring the RPCs' own graceful-return style.
async function guardedRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  fallback: unknown,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return fallback;
  return data;
}

// Reads the persisted analysis snapshot for a dataset (falls back to [] if none).
export async function getDatasetAnalysis(datasetId: string): Promise<AnalysisReport | null> {
  const supabase = await createClient();
  try {
    await requireUser(supabase);
    const { data } = await supabase
      .from("dataset_analyses")
      .select("report, markdown, roles, sensitivity, updated_at")
      .eq("dataset_id", datasetId)
      .maybeSingle();
    if (!data?.report) return null;
    return {
      ...(data.report as AnalysisReport),
      markdown: data.markdown ?? "",
      sensitivity: data.sensitivity,
    };
  } catch {
    return null;
  }
}

// Appends the analysis snapshot as an 'insight' component of a report.
export async function addAnalysisToReport(
  reportId: string,
  datasetId: string,
): Promise<AnalysisActionResult> {
  const supabase = await createClient();
  try {
    await requireUser(supabase);
    const { error } = await supabase.rpc("add_analysis_component", {
      p_report_id: reportId,
      p_dataset_id: datasetId,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/reports/${reportId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add analysis to report." };
  }
}