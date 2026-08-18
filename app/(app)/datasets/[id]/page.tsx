import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ColumnStats, Dataset, Operation } from "@/lib/types";
import { DatasetWorkspace } from "@/components/dataset-workspace";
import type { AnalysisReport } from "@/lib/analysis/types";

export const dynamic = "force-dynamic";

export default async function DatasetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: dataset } = await supabase
    .from("datasets")
    .select("*")
    .eq("id", id)
    .single();

  if (!dataset) notFound();

  const [statsRes, opsRes, analysisRes] = await Promise.all([
    supabase.from("dataset_column_stats").select("*").eq("dataset_id", id),
    supabase
      .from("dataset_operations")
      .select("*")
      .eq("dataset_id", id)
      .order("applied_at", { ascending: false })
      .limit(50),
    supabase.from("dataset_analyses").select("*").eq("dataset_id", id).maybeSingle(),
  ]);

  const analysisRow = analysisRes.data as {
    report?: unknown;
    markdown?: string | null;
    sensitivity?: string | null;
    updated_at?: string | null;
  } | null;
  const initialReport: AnalysisReport | null = analysisRow?.report
    ? ({
        ...(analysisRow.report as AnalysisReport),
        markdown: analysisRow.markdown ?? "",
      } as AnalysisReport)
    : null;

  return (
    <DatasetWorkspace
      dataset={dataset as Dataset}
      initialStats={(statsRes.data ?? []) as ColumnStats[]}
      initialOps={(opsRes.data ?? []) as Operation[]}
      initialReport={initialReport}
    />
  );
}