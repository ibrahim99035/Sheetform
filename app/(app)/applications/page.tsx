import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listApplications } from "@/lib/applications";
import { getRoleContext } from "@/lib/rbac";
import { buttonClasses } from "@/components/ui/button";
import { ApplicationList } from "@/components/application-list";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [apps, roleContext] = await Promise.all([listApplications(), getRoleContext()]);

  const canSubmit =
    roleContext.isSuperadmin ||
    roleContext.role === "owner" ||
    roleContext.role === "manager" ||
    roleContext.role === "pharmacist";

  return (
    <div className="animate-slide-up">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-foreground">Applications</h1>
          <span className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">
            {apps.length}
          </span>
        </div>
        {canSubmit && (
          <Link href="/applications/new" className={buttonClasses("primary", "md")}>
            <Plus className="h-4 w-4" />
            New application
          </Link>
        )}
      </div>
      <ApplicationList applications={apps} />
    </div>
  );
}