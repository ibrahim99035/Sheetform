import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrgCreateForm } from "@/components/org-create-form";

export default async function OrgNewPage() {
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

  if (membership) {
    redirect(`/org/${membership.organization_id}`);
  }

  return (
    <div className="mx-auto max-w-lg animate-slide-up">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">New organization</h1>
        <p className="mt-0.5 text-sm text-muted">
          Create an organization to manage your pharmacy&apos;s data and team.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <OrgCreateForm />
      </div>
    </div>
  );
}
