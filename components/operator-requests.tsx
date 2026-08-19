"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Inbox, Loader2 } from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import type { ColumnRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface DataRequest {
  role: ColumnRole;
  label: string;
}

interface OperatorRequestRow {
  dataset_id: string;
  dataset_name: string;
  owner_email: string | null;
  data_requests: DataRequest[];
  fulfilled: boolean;
}

export function OperatorRequests({
  initialRequests,
}: {
  initialRequests: OperatorRequestRow[];
}) {
  const supabase = useSupabase();
  const [rows, setRows] = useState(initialRequests);
  const [toggling, setToggling] = useState<string | null>(null);

  const toggleFulfilled = async (datasetId: string, current: boolean) => {
    setToggling(datasetId);
    const target = rows.find((r) => r.dataset_id === datasetId);
    if (!target) return;

    const newRequests = current ? null : target.data_requests;
    const { error } = await supabase
      .from("datasets")
      .update({ data_requests: newRequests })
      .eq("id", datasetId);

    if (!error) {
      setRows((prev) =>
        prev.map((r) =>
          r.dataset_id === datasetId ? { ...r, fulfilled: !current } : r,
        ),
      );
    }
    setToggling(null);
  };

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface py-12 text-center">
        <Inbox className="h-6 w-6 text-faint" />
        <p className="text-sm text-muted">No outstanding data requests.</p>
      </div>
    );
  }

  const outstanding = rows.filter((r) => !r.fulfilled);
  const fulfilled = rows.filter((r) => r.fulfilled);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <h2 className="text-sm font-semibold text-foreground">
          Data requests
        </h2>
        {outstanding.length > 0 && (
          <Badge variant="warning" dot="pulse">
            {outstanding.length} outstanding
          </Badge>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Dataset</th>
                <th className="px-4 py-2.5">Owner</th>
                <th className="px-4 py-2.5">Missing roles</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {[...outstanding, ...fulfilled].map((row) => (
                <tr
                  key={row.dataset_id}
                  className={`transition-colors hover:bg-surface-subtle/40 ${
                    row.fulfilled ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {row.dataset_name}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {row.owner_email ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {row.data_requests.map((r) => (
                        <span
                          key={r.role}
                          className="inline-block rounded-full border border-danger/25 bg-danger-subtle px-2 py-0.5 text-[10px] font-medium text-danger-text"
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() =>
                        toggleFulfilled(row.dataset_id, row.fulfilled)
                      }
                      disabled={toggling === row.dataset_id}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition hover:bg-surface-subtle"
                      title={
                        row.fulfilled
                          ? "Mark as outstanding"
                          : "Mark as sent to client"
                      }
                    >
                      {toggling === row.dataset_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : row.fulfilled ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted" />
                      )}
                      {row.fulfilled ? "Sent" : "Mark sent"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
