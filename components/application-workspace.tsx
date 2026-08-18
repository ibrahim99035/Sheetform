"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, FileText, FolderOpen, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addReportBlock,
  deleteReportBlock,
  getReportBlocks,
  reorderReportBlocks,
  type ReportBlockContent,
  type ReportBlockRow,
} from "@/lib/actions/report-blocks";
import { getDatasetWorkspaceData } from "@/lib/actions/dataset-workspace";
import { publishReport } from "@/lib/actions/reports";
import type { ApplicationDetail } from "@/lib/applications";
import type { BranchOption } from "@/lib/reports";
import { DatasetWorkspace } from "@/components/dataset-workspace";
import { ReportBuilder } from "@/components/report-builder";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/ui/toast";

function isReadyFile(detail: ApplicationDetail, file: ApplicationDetail["files"][number]) {
  return file.dataset?.status === "ready";
}

export function ApplicationWorkspace({
  detail,
  branches,
  initialDatasetId = null,
}: {
  detail: ApplicationDetail;
  branches: BranchOption[];
  initialDatasetId?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { application, files, isOperator } = detail;
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(initialDatasetId);

  const blocksKey = ["report-blocks", application.id];

  const blocksQuery = useQuery({
    queryKey: blocksKey,
    queryFn: () => getReportBlocks(application.id),
    enabled: isOperator,
  });

  const workspace = useQuery({
    queryKey: ["dataset-workspace", selectedDatasetId],
    queryFn: () => getDatasetWorkspaceData(selectedDatasetId!),
    enabled: isOperator && !!selectedDatasetId,
  });

  const selectDataset = (datasetId: string) => {
    setSelectedDatasetId(datasetId);
    router.replace(`/applications/${application.id}?dataset=${datasetId}`, { scroll: false });
  };

  const backToFiles = () => {
    setSelectedDatasetId(null);
    router.replace(`/applications/${application.id}`, { scroll: false });
  };

  const handleAddBlock = async (content: ReportBlockContent) => {
    const res = await addReportBlock(application.id, content);
    if (!res.ok) {
      toast({ kind: "error", text: res.error });
      return;
    }
    toast({ kind: "success", text: "Block added to the report." });
    queryClient.invalidateQueries({ queryKey: blocksKey });
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const blocks = blocksQuery.data ?? [];
    const j = index + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[j]] = [next[j], next[index]];
    queryClient.setQueryData(blocksKey, next);
    startTransition(async () => {
      const res = await reorderReportBlocks(application.id, next.map((b) => b.id));
      if (!res.ok) {
        toast({ kind: "error", text: res.error });
        queryClient.invalidateQueries({ queryKey: blocksKey });
      }
    });
  };

  const removeBlock = (id: string) => {
    const blocks = blocksQuery.data ?? [];
    queryClient.setQueryData(
      blocksKey,
      blocks.filter((b) => b.id !== id),
    );
    startTransition(async () => {
      const res = await deleteReportBlock(id);
      if (!res.ok) {
        toast({ kind: "error", text: res.error });
        queryClient.invalidateQueries({ queryKey: blocksKey });
      }
    });
  };

  const blocks = (blocksQuery.data ?? []) as ReportBlockRow[];
  const [reportTitle, setReportTitle] = useState(`${application.title} — report`);

  const canPublish = reportTitle.trim().length > 0 && blocks.length > 0 && !pending;

  const publish = () => {
    if (!canPublish) return;
    startTransition(async () => {
      const res = await publishReport({
        orgId: application.organization_id,
        branchId: application.branch_id,
        title: reportTitle.trim(),
        summary: application.note,
        components: blocks.map((b) => ({
          kind: b.kind,
          title: b.title,
          body:
            b.kind === "chart"
              ? { ...(b.body ?? {}), chart_type: b.chart_type ?? "bar" }
              : (b.body ?? {}),
          visibility: (b.branch_ids?.length ?? 0) > 0 ? "branch" : "org",
          branchIds: (b.branch_ids?.length ?? 0) > 0 ? (b.branch_ids ?? []) : undefined,
        })),
        items: [],
        applicationIds: [application.id],
      });
      if (!res.ok) {
        toast({ kind: "error", text: res.error });
        return;
      }
      toast({ kind: "success", text: "Report published." });
      router.push(`/reports/${res.reportId}`);
      router.refresh();
    });
  };

  const selectedFile = files.find((f) => f.dataset?.id === selectedDatasetId);
  const selectedReady = selectedFile ? isReadyFile(detail, selectedFile) : false;

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{application.title}</h1>
            <StatusBadge status={application.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {application.org_name}
            {application.branch_name ? ` · ${application.branch_name}` : " · org-wide"} · submitted{" "}
            {new Date(application.created_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
          {application.note && <p className="mt-2 max-w-2xl text-sm text-muted">{application.note}</p>}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <FolderOpen className="h-3.5 w-3.5 text-brand" />
            Files ({files.length})
          </h3>
          {files.length === 0 ? (
            <p className="text-sm text-faint">No files attached.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {files.map((f) => {
                const ready = isReadyFile(detail, f);
                const active = f.dataset?.id === selectedDatasetId;
                const selectable = isOperator && ready;
                return (
                  <li
                    key={f.id}
                    className={selectable ? "group relative flex flex-wrap items-center gap-3 py-2.5" : "flex flex-wrap items-center gap-3 py-2.5"}
                  >
                    <button
                      type="button"
                      disabled={!selectable}
                      onClick={() => selectDataset(f.dataset!.id)}
                      className={[
                        "flex min-w-0 flex-1 flex-wrap items-center gap-3 text-left",
                        selectable ? "cursor-pointer" : "cursor-default",
                      ].join(" ")}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{f.original_filename}</span>
                        <span className="block text-xs text-faint">
                          {f.dataset?.name ?? "—"}
                          {f.sheet_name ? ` · ${f.sheet_name}` : ""}
                          {f.dataset ? ` · ${f.dataset.row_count.toLocaleString()} rows` : ""}
                        </span>
                      </span>
                    </button>
                    {active ? (
                      <Badge variant="brand">open</Badge>
                    ) : f.dataset ? (
                      <StatusBadge status={f.dataset.status} />
                    ) : (
                      <Badge variant="neutral">processing</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {isOperator && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-foreground">Analyze & build report</h3>
              <p className="text-sm text-muted">
                Open a ready dataset to analyze it — every analysis becomes a persisted
                building block in the report below.
              </p>
            </div>
          </div>

          {!selectedDatasetId && (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-sm text-faint">
              Select a ready file above to open its dataset workspace.
            </div>
          )}

          {selectedDatasetId && workspace.isLoading && (
            <div className="space-y-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-72 w-full" />
            </div>
          )}

          {selectedDatasetId && workspace.isError && (
            <div className="rounded-xl border border-danger/25 bg-danger-subtle px-4 py-3 text-sm text-danger-text">
              {(workspace.error as Error).message}
            </div>
          )}

          {selectedDatasetId && workspace.data && selectedReady && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={backToFiles}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-muted transition hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to application files
              </button>
              <DatasetWorkspace
                dataset={workspace.data.dataset}
                initialStats={workspace.data.stats}
                initialOps={workspace.data.ops}
                initialReport={workspace.data.analysis}
                onAddBlock={(block) => {
                  void handleAddBlock(block);
                }}
              />
            </div>
          )}

          {selectedDatasetId && workspace.data && !selectedReady && (
            <div className="rounded-xl border border-warning/25 bg-warning-subtle px-4 py-3 text-sm text-warning-text">
              This file is not ready to analyze yet.
            </div>
          )}

          {blocksQuery.isLoading && (
            <Card>
              <CardContent className="flex items-center gap-2 py-6 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-brand" />
                Loading report blocks…
              </CardContent>
            </Card>
          )}
          {!blocksQuery.isLoading && (
            <ReportBuilder
              title={reportTitle}
              onTitleChange={setReportTitle}
              blocks={blocks}
              branches={branches}
              onCustom={(doc) => {
                void handleAddBlock({
                  kind: "text",
                  title: "Custom block",
                  body: { text: doc },
                  chartType: null,
                  branchIds: [],
                });
              }}
              onMove={moveBlock}
              onRemove={removeBlock}
              onPublish={publish}
              pending={pending}
              canPublish={canPublish}
            />
          )}
        </div>
      )}
    </div>
  );
}