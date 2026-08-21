import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrgSettings } from "@/components/org-settings";

export const dynamic = "force-dynamic";

export default async function OrgSettingsPage({
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

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!org) notFound();

  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("organization_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || !["owner", "manager"].includes(membership.role)) {
    redirect(`/org/${id}`);
  }

  const [{ data: profile }, { data: members }, { data: branches }] = await Promise.all([
    supabase.from("org_profile").select("*").eq("organization_id", id).maybeSingle(),
    supabase.from("org_members").select("user_id, role").eq("organization_id", id),
    supabase.from("branches").select("id, name").eq("organization_id", id),
  ]);

  return (
    <OrgSettings
      orgId={id}
      profile={profile as Record<string, string> | null}
      members={members ?? []}
      branches={branches ?? []}
    />
  );
}
