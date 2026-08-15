import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrganizations, getBranches } from "@/lib/reports";
import { ApplicationSubmit, type TemplateOption } from "@/components/application-submit";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [organizations, branches, templateRes] = await Promise.all([
    getOrganizations(),
    getBranches(),
    supabase.from("templates").select("code, name, description, type").eq("active", true).order("name"),
  ]);

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">New application</h1>
        <p className="mt-0.5 text-sm text-muted">
          Submit one or several Excel/CSV files for analysis. Attach an analysis template so the
          correct pharmacy KPIs can be computed automatically.
        </p>
      </div>
      <ApplicationSubmit
        organizations={organizations}
        branches={branches}
        templates={(templateRes.data ?? []) as TemplateOption[]}
      />
    </div>
  );
}