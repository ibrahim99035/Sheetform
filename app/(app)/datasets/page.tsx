import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Dataset } from "@/lib/types";
import { buttonClasses } from "@/components/ui/button";
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

  const { data: membership } = await supabase
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="animate-slide-up">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-foreground">Datasets</h1>
          <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">
            {datasets.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {membership && (
            <Link
              href={`/org/${membership.organization_id}`}
              className={buttonClasses("secondary", "md")}
            >
              <Building2 className="h-4 w-4" />
              Organization view
            </Link>
          )}
          <Link href="/datasets/new" className={buttonClasses("primary", "md")}>
            <Plus className="h-4 w-4" />
            New dataset
          </Link>
        </div>
      </div>
      <DatasetList initial={datasets} />
    </div>
  );
}
