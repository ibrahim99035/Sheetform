import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Dataset } from "@/lib/types";
import { DatasetList } from "./dataset-list";

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("datasets")
    .select("*")
    .order("created_at", { ascending: false });

  const datasets = (data ?? []) as Dataset[];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Datasets</h1>
        <Link
          href="/datasets/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          + New dataset
        </Link>
      </div>
      <DatasetList initial={datasets} />
    </div>
  );
}