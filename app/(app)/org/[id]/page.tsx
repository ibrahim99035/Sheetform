import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrgDashboard } from "@/lib/actions/org-dashboard";
import { OrgDashboard } from "@/components/org-dashboard";

export const dynamic = "force-dynamic";

export default async function OrgPage({
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

  const data = await getOrgDashboard(id);
  if (!data) notFound();

  return <OrgDashboard data={data} />;
}
