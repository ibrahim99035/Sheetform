import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountOrgCard, type OrgProfileSummary } from "@/components/account-org-card";
import { Trans } from "@/components/trans";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("org_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let org: { id: string; name: string; status: string } | null = null;
  let profile: OrgProfileSummary = null;
  if (membership?.organization_id) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("id, name, status")
      .eq("id", membership.organization_id)
      .maybeSingle();
    org = orgRow ?? null;

    const { data: profileRow } = await supabase
      .from("org_profile")
      .select(
        "pharmacy_name, address, phone, license_no, license_expiry, rejection_reason",
      )
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    profile = (profileRow as OrgProfileSummary) ?? null;
  }

  return (
    <div className="animate-slide-up space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          <Trans k="settings.title" />
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          <Trans k="settings.subtitle" />
        </p>
      </div>
      <AccountOrgCard org={org} profile={profile} />
      <SettingsForm
        email={user.email ?? ""}
        displayName={(user.user_metadata as Record<string, string>)?.display_name ?? ""}
      />
    </div>
  );
}
