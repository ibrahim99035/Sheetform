import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Dataset } from "@/lib/types";
import { UserDashboard } from "@/components/user-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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
    <UserDashboard
      datasets={datasets}
      orgId={membership?.organization_id ?? null}
    />
  );
}
