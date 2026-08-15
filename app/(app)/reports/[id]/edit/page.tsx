import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getReportDetail,
  getReportApps,
  getOrganizations,
  getBranches,
  getApplications,
} from "@/lib/reports";
import { isSuperAdmin } from "@/lib/admin";
import { ReportComposer } from "@/components/reports/report-composer";

export const dynamic = "force-dynamic";

export default async function EditReportPage({
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

  if (!(await isSuperAdmin())) redirect("/reports");

  const [detail, apps, organizations, branches, allApps] = await Promise.all([
    getReportDetail(id),
    getReportApps(id),
    getOrganizations(),
    getBranches(),
    getApplications(),
  ]);

  if (!detail) notFound();

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Revise report</h1>
        <p className="mt-0.5 text-sm text-muted">
          Update the title, content, and linked applications. Published state is preserved on save.
        </p>
      </div>
      <ReportComposer
        organizations={organizations}
        branches={branches}
        apps={allApps}
        reportId={id}
        initial={{
          orgId: detail.report.organization_id,
          branchId: detail.report.branch_id,
          title: detail.report.title,
          summary: detail.report.summary,
          applicationIds: apps?.map((a) => a.application_id) ?? [],
          components: detail.components.map((c) => ({
            kind: c.kind,
            title: c.title,
            body: c.body,
            visibility: c.visibility,
            branch_ids: c.branch_ids,
          })),
          items: detail.items.map((it) => ({
            visibility: it.visibility,
            branch_ids: it.branch_ids,
            title: it.title,
            body: it.body,
          })),
        }}
      />
    </div>
  );
}