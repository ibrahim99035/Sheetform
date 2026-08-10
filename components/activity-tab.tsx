"use client";

import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase/provider";
import type { Operation } from "@/lib/types";

interface ActivityTabProps {
  datasetId: string;
  initialOps: Operation[];
  onUndo: () => void;
  onRedo: () => void;
}

function describeOperation(op: Operation): string {
  const p = op.payload as Record<string, unknown>;
  switch (op.operation_type) {
    case "rename_column":
      return `${p.old_key} → ${p.new_key}`;
    case "edit_cell":
      return `${p.column_key} of row ${p.row_id}`;
    case "filter_rows":
      return p.label ? String(p.label) : "filtered rows";
    case "dedupe":
      return "removed duplicate rows";
    default:
      return op.operation_type;
  }
}

const TYPE_ICON: Record<string, string> = {
  rename_column: "✎",
  edit_cell: "✏",
  filter_rows: "⊘",
  dedupe: "⧉",
};

export function ActivityTab({ datasetId, initialOps, onUndo, onRedo }: ActivityTabProps) {
  const supabase = useSupabase();

  const { data: ops } = useQuery({
    queryKey: ["ops", datasetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dataset_operations")
        .select("*")
        .eq("dataset_id", datasetId)
        .order("applied_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Operation[];
    },
    initialData: initialOps,
  });

  const latest = ops?.find((o) => o.undone_at === null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">Operation history</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onUndo}
            disabled={!latest}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
          >
            ↺ Undo
          </button>
          <button
            onClick={onRedo}
            disabled={!ops?.some((o) => o.undone_at !== null)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
          >
            ↻ Redo
          </button>
        </div>
      </div>

      {!ops || ops.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          No operations yet. Edit cells or apply transforms on the Data tab.
        </p>
      ) : (
        <ol className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {ops.map((op) => (
            <li
              key={op.id}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                op.undone_at ? "opacity-50" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-6 text-center text-neutral-400">
                  {TYPE_ICON[op.operation_type] ?? "•"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-neutral-900">
                    <span className="capitalize">{op.operation_type.replace("_", " ")}</span>
                    {op.operation_type !== "rename_column" && (
                      <span className="text-neutral-500"> — {describeOperation(op)}</span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {new Date(op.applied_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  op.undone_at
                    ? "bg-neutral-100 text-neutral-500"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {op.undone_at ? "Undone" : "Applied"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}