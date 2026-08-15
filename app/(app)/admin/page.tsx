import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin, listUsers } from "@/lib/admin";
import { AdminUsers } from "@/components/admin-users";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await isSuperAdmin())) redirect("/datasets");

  const users = await listUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Admin</h1>
        <p className="mt-0.5 text-sm text-muted">
          Every SiroQ user and their files.
        </p>
      </div>
      <AdminUsers users={users} currentUserId={user.id} />
    </div>
  );
}