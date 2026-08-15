import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/admin";
import { getOrganizations, getBranches, getApplications } from "@/lib/reports";
import { ReportComposer } from "@/components/reports/report-composer";

export const dynamic = "force-dynamic";

export default async function NewReportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await isSuperAdmin())) redirect("/reports");

  const [organizations, branches, apps] = await Promise.all([
    getOrganizations(),
    getBranches(),
    getApplications(),
  ]);

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">New report</h1>
        <p className="mt-0.5 text-sm text-muted">
          Publish insights for an organization. Choose linked applications first, then snapshot KPIs into the report after publishing.
        </p>
      </div>
      <ReportComposer organizations={organizations} branches={branches} apps={apps} />
    </div>
  );
}