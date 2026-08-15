import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReportDetail, getReportApps } from "@/lib/reports";
import { isSuperAdmin } from "@/lib/admin";
import { ReportViewer } from "@/components/reports/report-viewer";

export const dynamic = "force-dynamic";

export default async function ReportPage({
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

  const [detail, apps, isOperator] = await Promise.all([
    getReportDetail(id),
    getReportApps(id),
    isSuperAdmin(),
  ]);

  if (!detail) notFound();

  return (
    <ReportViewer detail={detail} isOperator={isOperator} apps={apps ?? []} />
  );
}