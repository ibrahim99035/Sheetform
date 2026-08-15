import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listReports } from "@/lib/reports";
import { isSuperAdmin } from "@/lib/admin";
import { buttonClasses } from "@/components/ui/button";
import { ReportList } from "@/components/reports/report-list";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [reports, isOperator] = await Promise.all([listReports(), isSuperAdmin()]);

  return (
    <div className="animate-slide-up">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-foreground">Reports</h1>
          <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">
            {reports.length}
          </span>
        </div>
        {isOperator && (
          <Link href="/reports/new" className={buttonClasses("primary", "md")}>
            <Plus className="h-4 w-4" />
            New report
          </Link>
        )}
      </div>
      <ReportList reports={reports} isOperator={isOperator} />
    </div>
  );
}