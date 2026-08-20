import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin, listUsers } from "@/lib/admin";
import { AdminUsers } from "@/components/admin-users";
import { OperatorRequests } from "@/components/operator-requests";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await isSuperAdmin())) redirect("/datasets");

  const users = await listUsers();

  const { data: requestsData } = await supabase
    .from("datasets")
    .select("id, name, data_requests, owner_id")
    .not("data_requests", "is", null);

  const ownerIds = [...new Set((requestsData ?? []).map((r) => r.owner_id))];
  const ownerEmails = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase.auth.admin.listUsers();
    if (owners?.users) {
      for (const u of owners.users) {
        if (ownerIds.includes(u.id)) {
          ownerEmails.set(u.id, u.email ?? "");
        }
      }
    }
  }

  interface RequestRow {
    id: string;
    name: string;
    data_requests: { role: string; label: string }[];
    owner_id: string;
  }

  const operatorRequests = ((requestsData ?? []) as RequestRow[]).map((r) => ({
    dataset_id: r.id,
    dataset_name: r.name,
    owner_email: ownerEmails.get(r.owner_id) ?? null,
    data_requests: r.data_requests.map((dr) => ({
      role: dr.role as import("@/lib/types").ColumnRole,
      label: dr.label,
    })),
    fulfilled: false,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Admin</h1>
        <p className="mt-0.5 text-sm text-muted">
          Every SiroQ user and their files.
        </p>
      </div>
      <OperatorRequests initialRequests={operatorRequests} />
      <AdminUsers users={users} currentUserId={user.id} />
    </div>
  );
}