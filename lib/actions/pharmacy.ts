"use server";

import { createClient } from "@/lib/supabase/server";
import { buildSuite, type PharmacySuite } from "@/lib/analysis/modules";
import { fetchAllRows } from "@/lib/dataset-rows";
import type { ColumnDef, DatasetKind } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PharmacyActionResult =
  | { ok: true; suite: PharmacySuite }
  | { ok: false; error: string };

async function requireUser(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

/**
 * Runs the deterministic pharmacy analytics suite for a dataset.
 *
 * Server-side projection: rows stream from the dataset RPC (paged, max
 * 10k/page), then lib/analysis/modules.ts projects them into the typed
 * module inputs and computes RFM, basket, ABC-XYZ, safety stock, expiry,
 * forecast, and (opt-in) benchmark aggregates. Fully deterministic — no AI.
 */
export async function runPharmacyAnalysis(
  datasetId: string,
  opts?: { kind?: DatasetKind | null; forecastMetric?: "units" | "revenue"; forecastHorizon?: number; benchmarkRegion?: string | null },
): Promise<PharmacyActionResult> {
  const supabase = await createClient();
  try {
    await requireUser(supabase);

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

    const columnDefs = ((dataset.column_defs ?? []) as ColumnDef[]).map((c) => ({
      key: c.key,
      label: c.label,
      type: (["string", "numeric", "date", "boolean"].includes(c.type) ? c.type : "string") as ColumnDef["type"],
      ...(c.role ? { role: c.role } : {}),
      ...(c.role_confidence ? { role_confidence: c.role_confidence } : {}),
    }));

    const rows = await fetchAllRows(supabase, datasetId);
    if (rows.length === 0) {
      return { ok: false, error: "Dataset has no rows to analyze." };
    }

    const suite = buildSuite(columnDefs, rows, {
      kind: opts?.kind ?? null,
      forecastMetric: opts?.forecastMetric ?? "units",
      forecastHorizon: opts?.forecastHorizon ?? 14,
      benchmarkRegion: opts?.benchmarkRegion ?? null,
    });

    return { ok: true, suite };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pharmacy analysis failed" };
  }
}
