import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getApplicationDetail } from "@/lib/applications";
import { getBranches } from "@/lib/reports";
import { ApplicationWorkspace } from "@/components/application-workspace";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({
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

  const [detail, branches] = await Promise.all([getApplicationDetail(id), getBranches()]);

  if (!detail) notFound();

  return <ApplicationWorkspace detail={detail} branches={branches} />;
}