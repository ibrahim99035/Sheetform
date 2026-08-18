"use client";

import { BarChart3, FileText, Sparkles, Table2 } from "lucide-react";
import type { ReportBlockRow } from "@/lib/actions/report-blocks";
import type { BranchOption } from "@/lib/reports";
import { ReportBlockBody } from "@/components/report-block-body";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const KIND_LABEL: Record<ReportBlockRow["kind"], { label: string; icon: React.ReactNode }> = {
  chart: { label: "Chart", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  table: { label: "Table", icon: <Table2 className="h-3.5 w-3.5" /> },
  insight: { label: "Insight", icon: <Sparkles className="h-3.5 w-3.5" /> },
  text: { label: "Text", icon: <FileText className="h-3.5 w-3.5" /> },
};

// Renders the report exactly as the published page will: title + component
// stack in sort order, each block scoped by branch/organization.
export function ReportPreview({
  title,
  blocks,
  branches,
}: {
  title: string;
  blocks: ReportBlockRow[];
  branches: BranchOption[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border/80 bg-surface-subtle/50 px-4 py-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted">{blocks.length} component{blocks.length === 1 ? "" : "s"} · preview as published</p>
      </div>
      <div className="space-y-4 p-4">
        {blocks.map((b) => {
          const meta = KIND_LABEL[b.kind];
          const branchNames = branches.filter((br) => b.branch_ids.includes(br.id)).map((br) => br.name);
          return (
            <Card key={b.id}>
              <CardContent className="space-y-2.5 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">
                      {meta.icon}
                      {meta.label}
                    </span>
                    {b.chart_type && <Badge variant="info">{b.chart_type}</Badge>}
                    <h4 className="truncate text-sm font-semibold text-foreground">{b.title}</h4>
                  </div>
                  <Badge variant={branchNames.length > 0 ? "info" : "success"}>
                    {branchNames.length > 0 ? branchNames.join(", ") : "org-wide"}
                  </Badge>
                </div>
                <ReportBlockBody body={b.body} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}