import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ColumnStats, Dataset, Operation } from "@/lib/types";
import { DatasetWorkspace } from "@/components/dataset-workspace";

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

  const [statsRes, opsRes] = await Promise.all([
    supabase.from("dataset_column_stats").select("*").eq("dataset_id", id),
    supabase
      .from("dataset_operations")
      .select("*")
      .eq("dataset_id", id)
      .order("applied_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <DatasetWorkspace
      dataset={dataset as Dataset}
      initialStats={(statsRes.data ?? []) as ColumnStats[]}
      initialOps={(opsRes.data ?? []) as Operation[]}
    />
  );
}