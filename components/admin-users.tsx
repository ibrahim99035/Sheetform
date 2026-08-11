"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, FolderOpen, Inbox, Loader2 } from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import type { AdminUserRow, AdminDatasetRow } from "@/lib/admin";
import type { DatasetStatus } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/cn";

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AdminUsers({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const supabase = useSupabase();
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [datasets, setDatasets] = useState<AdminDatasetRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openUser = async (user: AdminUserRow) => {
    setSelected(user);
    setDatasets(null);
    setError(null);
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_datasets", {
      p_user_id: user.user_id,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDatasets((data ?? []) as AdminDatasetRow[]);
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5 text-right">Files</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5">Last active</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {users.map((user) => (
                <tr
                  key={user.user_id}
                  className="transition-colors hover:bg-surface-subtle/40"
                >
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "font-medium text-foreground",
                        user.user_id === currentUserId && "text-brand",
                      )}
                    >
                      {user.email}
                    </span>
                    {user.user_id === currentUserId && (
                      <span className="ml-2 rounded bg-brand-subtle px-1.5 py-0.5 text-[11px] font-medium text-brand">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                    {user.dataset_count}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{shortDate(user.created_at)}</td>
                  <td className="px-4 py-2.5 text-muted">{shortDate(user.last_sign_in_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => openUser(user)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-brand transition hover:bg-brand-subtle"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      View files
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.email ?? "User"}
        description={`${selected?.dataset_count ?? 0} file${(selected?.dataset_count ?? 0) === 1 ? "" : "s"}`}
        className="max-w-lg"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            Loading files…
          </div>
        ) : error ? (
          <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        ) : datasets && datasets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="h-6 w-6 text-faint" />
            <p className="text-sm text-muted">No files yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {datasets?.map((ds) => (
              <li key={ds.id}>
                <Link
                  href={`/datasets/${ds.id}`}
                  className="flex items-center gap-3 px-1 py-3 transition-colors hover:bg-surface-subtle/60"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {ds.name}
                      </span>
                      <StatusBadge status={ds.status as DatasetStatus} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {ds.row_count?.toLocaleString() ?? 0} rows · updated{" "}
                      {shortDate(ds.updated_at)}
                    </span>
                  </span>
                  <span className="text-xs text-muted">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}