"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CopyX,
  Filter,
  History,
  PencilLine,
  PenLine,
  RotateCcw,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
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

const TYPE_META: Record<
  string,
  { icon: LucideIcon; className: string; label: string }
> = {
  rename_column: { icon: PencilLine, className: "bg-info-subtle text-info-text", label: "Rename column" },
  edit_cell: { icon: PenLine, className: "bg-brand-subtle text-brand", label: "Edit cell" },
  filter_rows: { icon: Filter, className: "bg-warning-subtle text-warning-text", label: "Filter rows" },
  dedupe: { icon: CopyX, className: "bg-success-subtle text-success-text", label: "Remove duplicates" },
};

export function ActivityTab({ datasetId, initialOps, onUndo, onRedo }: ActivityTabProps) {
  const supabase = useSupabase();

  const { data: ops } = useQuery({
    queryKey: ["ops", datasetId],
    staleTime: 0,
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
  const hasRedo = ops?.some((o) => o.undone_at !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Operation history</h3>
        <div className="flex items-center gap-2">
          <Button onClick={onUndo} disabled={!latest} size="sm">
            <RotateCcw className="h-3.5 w-3.5" />
            Undo
          </Button>
          <Button onClick={onRedo} disabled={!hasRedo} size="sm">
            <RotateCw className="h-3.5 w-3.5" />
            Redo
          </Button>
        </div>
      </div>

      {!ops || ops.length === 0 ? (
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="No operations yet"
          description="Edit cells or apply transforms on the Data tab to start building a history."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Applied changes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ol className="divide-y divide-border/60">
              {ops.map((op) => {
                const meta = TYPE_META[op.operation_type] ?? {
                  icon: History,
                  className: "bg-surface-subtle text-faint",
                  label: op.operation_type,
                };
                const Icon = meta.icon;
                return (
                  <li
                    key={op.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle/40",
                      op.undone_at && "opacity-50",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          meta.className,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {meta.label}
                          {op.operation_type !== "rename_column" && (
                            <span className="font-normal text-muted">
                              {" "}
                              — {describeOperation(op)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-faint">
                          {new Date(op.applied_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant={op.undone_at ? "neutral" : "success"}>
                      {op.undone_at ? "Undone" : "Applied"}
                    </Badge>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
