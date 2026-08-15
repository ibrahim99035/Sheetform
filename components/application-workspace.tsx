"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import { useQuery } from "@tanstack/react-query";
import { fetchGroupBy } from "@/lib/dataset-api";
import type { ApplicationDetail, ApplicationFileDetail } from "@/lib/applications";
import type { ColumnDef } from "@/lib/types";
import type { BranchOption, ComponentKind, ItemVisibility } from "@/lib/reports";
import { publishReport } from "@/lib/actions/reports";
import { RichTextEditor, emptyRichTextDoc, type RichTextDoc } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/ui/toast";

const METRICS = ["revenue", "units", "margin"];
const BUCKETS = ["day", "month", "quarter", "year"];
const AGGS = ["count", "sum", "avg"] as const;

const VISIBILITY_LABEL: Record<ItemVisibility, string> = {
  org: "Full access",
  restricted: "Exclusive",
  branch: "Branch",
};

interface DraftComponent {
  key: number;
  kind: ComponentKind;
  title: string;
  visibility: ItemVisibility;
  branchIds: string[];
  body: Record<string, unknown>;
}

let keySeq = 0;

function BarList({ series }: { series: { bucket?: string; value?: number | null }[] }) {
  const max = Math.max(...series.map((s) => Number(s.value ?? 0)), 1);
  return (
    <div className="space-y-1">
      {series.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-xs text-muted">{String(s.bucket ?? "")}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-surface-subtle">
            <div className="h-full rounded bg-brand/70" style={{ width: `${Math.min(100, (Number(s.value ?? 0) / max) * 100)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">{s.value?.toLocaleString() ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

interface DatasetAnalysisProps {
  file: ApplicationFileDetail;
  onAdd: (draft: Omit<DraftComponent, "key">) => void;
}

function DatasetAnalysis({ file, onAdd }: DatasetAnalysisProps) {
  const supabase = useSupabase();
  const datasetId = file.dataset?.id ?? "";
  const columns = (file.column_defs as ColumnDef[] | null) ?? [];

  const [metric, setMetric] = useState("revenue");
  const [bucket, setBucket] = useState("month");
  const [groupCol, setGroupCol] = useState(columns[0]?.key ?? "");
  const [aggFn, setAggFn] = useState<(typeof AGGS)[number]>("count");
  const [aggCol, setAggCol] = useState<string | null>(null);
  const [topN, setTopN] = useState(10);

  const kpis = useQuery({
    queryKey: ["app-kpis", datasetId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dataset_kpis", { p_dataset_id: datasetId });
      if (error) throw new Error(error.message);
      return data as Record<string, unknown>;
    },
    enabled: !!datasetId,
  });

  const series = useQuery({
    queryKey: ["app-series", datasetId, metric, bucket],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("time_series", {
        p_dataset_id: datasetId,
        p_metric: metric,
        p_bucket: bucket,
      });
      if (error) throw new Error(error.message);
      return data as { bucket: string; value: number }[];
    },
    enabled: !!datasetId,
  });

  const groups = useQuery({
    queryKey: ["app-groupby", datasetId, groupCol, aggFn, aggCol, topN],
    queryFn: () =>
      fetchGroupBy(supabase, datasetId, {
        group: groupCol,
        agg: aggFn === "count" ? null : (aggCol ?? undefined),
        fn: aggFn,
        topN,
        minCount: 1,
      }),
    enabled: !!datasetId && !!groupCol,
  });

  const numericColumns = columns.filter((c) => c.type === "numeric");

  const addKpi = () => {
    if (!kpis.data) return;
    onAdd({
      kind: "insight",
      title: "KPI summary",
      visibility: "org",
      branchIds: [],
      body: kpis.data,
    });
  };

  const addChart = () => {
    if (!series.data || series.data.length === 0) return;
    onAdd({
      kind: "chart",
      title: `${metric} · ${bucket}`,
      visibility: "org",
      branchIds: [],
      body: { series: series.data.map((s) => ({ bucket: s.bucket, value: s.value })), metric },
    });
  };

  const addGroup = () => {
    const rows = groups.data ?? [];
    if (rows.length === 0) return;
    onAdd({
      kind: "chart",
      title: `${aggFn}${aggFn === "count" ? "" : ` ${aggCol ?? ""}`} by ${groupCol}`,
      visibility: "org",
      branchIds: [],
      body: {
        series: rows.map((r) => ({ bucket: r.label === "" ? "(empty)" : r.label, value: r.value ?? r.count })),
        metric: `${aggFn}${aggFn === "count" ? "" : ` ${aggCol ?? ""}`} by ${groupCol}`,
      },
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            Analysis building blocks
          </h4>
          <span className="text-xs text-faint">{file.original_filename}</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">KPI summary</span>
              <Button size="sm" variant="ghost" onClick={addKpi} disabled={!kpis.data}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {kpis.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : kpis.data && Object.keys(kpis.data).length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                {Object.entries(kpis.data).slice(0, 6).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/50 pb-1">
                    <dt className="truncate text-xs text-faint">{k}</dt>
                    <dd className="text-xs font-medium tabular-nums text-foreground">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-faint">No template matched — KPIs unavailable.</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted">Time series</span>
              <Select className="h-7 w-24 text-xs" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">
                {METRICS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
              <Select className="h-7 w-28 text-xs" value={bucket} onChange={(e) => setBucket(e.target.value)} aria-label="Bucket">
                {BUCKETS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" onClick={addChart} disabled={!series.data || series.data.length === 0}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {series.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : series.data && series.data.length > 0 ? (
              <BarList series={series.data} />
            ) : (
              <p className="text-xs text-faint">No series for this template/metric.</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted">Aggregation</span>
              <Select className="h-7 w-28 text-xs" value={groupCol} onChange={(e) => setGroupCol(e.target.value)} aria-label="Group by">
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </Select>
              <Select className="h-7 w-20 text-xs" value={aggFn} onChange={(e) => setAggFn(e.target.value as (typeof AGGS)[number])} aria-label="Aggregate">
                {AGGS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </Select>
              {aggFn !== "count" && (
                <Select className="h-7 w-28 text-xs" value={aggCol ?? ""} onChange={(e) => setAggCol(e.target.value || null)} aria-label="On column">
                  {numericColumns.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </Select>
              )}
              <Input className="h-7 w-16 text-xs" type="number" min={1} max={500} value={topN} onChange={(e) => setTopN(Number(e.target.value) || 10)} aria-label="Top N" />
              <Button size="sm" variant="ghost" onClick={addGroup} disabled={!groups.data || groups.data.length === 0}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {groups.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : groups.data && groups.data.length > 0 ? (
              <BarList series={groups.data.map((r) => ({ bucket: r.label, value: r.value ?? r.count }))} />
            ) : (
              <p className="text-xs text-faint">Pick a column to aggregate by.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ApplicationWorkspace({
  detail,
  branches,
}: {
  detail: ApplicationDetail;
  branches: BranchOption[];
}) {
  const router = useRouter();
  const { application, files, isOperator } = detail;
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [reportTitle, setReportTitle] = useState(`${application.title} — report`);
  const [drafts, setDrafts] = useState<DraftComponent[]>([]);
  const [customDoc, setCustomDoc] = useState<RichTextDoc>(emptyRichTextDoc());

  const orgBranches = useMemo(() => branches.filter((b) => b.organization_id === application.organization_id), [branches, application.organization_id]);

  const addDraft = (draft: Omit<DraftComponent, "key">) => {
    setDrafts((prev) => [...prev, { ...draft, key: keySeq++ }]);
  };

  const patchDraft = (key: number, patch: Partial<DraftComponent>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const removeDraft = (key: number) => setDrafts((prev) => prev.filter((d) => d.key !== key));

  const moveDraft = (index: number, dir: -1 | 1) => {
    setDrafts((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const addCustom = () => {
    const hasContent = JSON.stringify(customDoc).length > 2;
    if (!hasContent) return;
    addDraft({
      kind: "text",
      title: "Custom block",
      visibility: "org",
      branchIds: [],
      body: { text: customDoc },
    });
    setCustomDoc(emptyRichTextDoc());
  };

  const canPublish = reportTitle.trim().length > 0 && drafts.length > 0 && !pending;

  const publish = () => {
    if (!canPublish) return;
    startTransition(async () => {
      const res = await publishReport({
        orgId: application.organization_id,
        branchId: application.branch_id,
        title: reportTitle.trim(),
        summary: application.note,
        components: drafts.map((d) => ({
          kind: d.kind,
          title: d.title,
          body: d.body,
          visibility: d.visibility,
          branchIds: d.branchIds.length > 0 ? d.branchIds : undefined,
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
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{f.original_filename}</p>
                    <p className="text-xs text-faint">
                      {f.dataset?.name ?? "—"}
                      {f.sheet_name ? ` · ${f.sheet_name}` : ""}
                      {f.dataset ? ` · ${f.dataset.row_count.toLocaleString()} rows` : ""}
                    </p>
                  </div>
                  {f.dataset && <StatusBadge status={f.dataset.status} />}
                  {!f.dataset && <Badge variant="neutral">processing</Badge>}
                </li>
              ))}
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
                Every analysis becomes a reusable component. Assemble them here, then publish to the organization.
              </p>
            </div>
            {files.length > 0 && drafts.length === 0 && (
              <Link href={`/datasets/${files[0].dataset?.id ?? ""}`} className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline">
                Open in dataset workspace →
              </Link>
            )}
          </div>

          {files
            .filter((f) => f.dataset && f.dataset.status === "ready")
            .map((f) => (
              <DatasetAnalysis key={f.id} file={f} onAdd={addDraft} />
            ))}
          {files.filter((f) => f.dataset && f.dataset.status === "ready").length === 0 && (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-sm text-faint">
              No ready datasets yet — analysis blocks appear once a file finishes importing.
            </div>
          )}

          <Card>
            <CardContent className="space-y-3 pt-4">
              <h4 className="text-sm font-semibold text-foreground">Custom block</h4>
              <RichTextEditor value={customDoc} onChange={setCustomDoc} placeholder="Write a custom narrative, interpretation, or note…" />
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={addCustom}>
                  <Plus className="h-3.5 w-3.5" />
                  Add custom block
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground">Report components</h4>
                <span className="text-xs text-muted">{drafts.length} added</span>
              </div>

              {drafts.length === 0 && (
                <p className="rounded-lg border border-dashed border-border-strong bg-surface px-3 py-4 text-sm text-faint">
                  Nothing yet. Add KPI summaries, charts, aggregations, or custom blocks above.
                </p>
              )}

              {drafts.map((d, i) => (
                <div key={d.key} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">{d.kind}</span>
                    <Input className="h-8 flex-1" value={d.title} onChange={(e) => patchDraft(d.key, { title: e.target.value })} />
                    <Select
                      className="h-8 w-36"
                      value={d.visibility}
                      onChange={(e) => patchDraft(d.key, { visibility: e.target.value as ItemVisibility, ...(e.target.value !== "branch" ? { branchIds: [] } : {}) })}
                      aria-label="Access"
                    >
                      {(Object.keys(VISIBILITY_LABEL) as ItemVisibility[]).map((v) => (
                        <option key={v} value={v}>
                          {VISIBILITY_LABEL[v]}
                        </option>
                      ))}
                    </Select>
                    <div className="flex items-center gap-0.5">
                      <Button size="sm" variant="ghost" onClick={() => moveDraft(i, -1)} disabled={i === 0} title="Move up">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => moveDraft(i, 1)} disabled={i === drafts.length - 1} title="Move down">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeDraft(d.key)} title="Remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {d.visibility === "branch" && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {orgBranches.map((b) => {
                        const on = d.branchIds.includes(b.id);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() =>
                              patchDraft(d.key, { branchIds: on ? d.branchIds.filter((id) => id !== b.id) : [...d.branchIds, b.id] })
                            }
                            className={on ? "rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-white" : "rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-foreground"}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                      {orgBranches.length === 0 && <span className="text-xs text-faint">No branches available.</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 overflow-x-auto text-xs text-faint">
                    {d.kind === "chart" && <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> chart series</span>}
                    {d.kind === "insight" && <span className="flex items-center gap-1"><Wand2 className="h-3 w-3" /> KPI block</span>}
                    {d.kind === "text" && <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> rich text block</span>}
                    <span className="font-medium text-muted">{VISIBILITY_LABEL[d.visibility]}</span>
                  </div>
                </div>
              ))}

              <div className="space-y-1.5 pt-1">
                <Label htmlFor="report-title">Report title</Label>
                <Input id="report-title" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted">
                  Linked application: <span className="font-medium text-foreground">{application.title}</span>
                  {application.branch_id ? " · " + (application.branch_name ?? "branch") : " · org-wide"}
                </p>
                <Button variant="primary" onClick={publish} disabled={!canPublish}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {drafts.length === 0 ? "Add a component to publish" : "Publish report"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}