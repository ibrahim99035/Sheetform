"use server";

import { createClient } from "@/lib/supabase/server";
import type { ColumnStats, Dataset, Operation } from "@/lib/types";
import type { AnalysisReport } from "@/lib/analysis/types";

export interface DatasetWorkspaceData {
  dataset: Dataset;
  stats: ColumnStats[];
  ops: Operation[];
  analysis: AnalysisReport | null;
}

function parseAnalysis(row: {
  report?: unknown;
  markdown?: string | null;
} | null): AnalysisReport | null {
  if (!row?.report) return null;
  return {
    ...(row.report as AnalysisReport),
    markdown: row.markdown ?? "",
  } as AnalysisReport;
}

export async function getDatasetWorkspaceData(
  datasetId: string,
): Promise<DatasetWorkspaceData | null> {
  const supabase = await createClient();
  const { data: dataset, error } = await supabase
    .from("datasets")
    .select("*")
    .eq("id", datasetId)
    .single();
  if (error || !dataset) return null;

  const [statsRes, opsRes, analysisRes] = await Promise.all([
    supabase.from("dataset_column_stats").select("*").eq("dataset_id", datasetId),
    supabase
      .from("dataset_operations")
      .select("*")
      .eq("dataset_id", datasetId)
      .order("applied_at", { ascending: false })
      .limit(50),
    supabase.from("dataset_analyses").select("*").eq("dataset_id", datasetId).maybeSingle(),
  ]);

  return {
    dataset: dataset as Dataset,
    stats: (statsRes.data ?? []) as ColumnStats[],
    ops: (opsRes.data ?? []) as Operation[],
    analysis: parseAnalysis(analysisRes.data as never),
  };
}