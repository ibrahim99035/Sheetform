"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Eye,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import type { ReportBlockRow } from "@/lib/actions/report-blocks";
import type { BranchOption } from "@/lib/reports";
import { RichTextEditor, emptyRichTextDoc, type RichTextDoc } from "@/components/rich-text-editor";
import { ReportBlockBody } from "@/components/report-block-body";
import { ReportPreview } from "@/components/report-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const KIND_LABEL: Record<ReportBlockRow["kind"], { label: string; icon: React.ReactNode }> = {
  chart: { label: "Chart", icon: <BarChart3 className="h-3 w-3" /> },
  table: { label: "Table", icon: <Table2 className="h-3 w-3" /> },
  insight: { label: "Insight", icon: <Sparkles className="h-3 w-3" /> },
  text: { label: "Text", icon: <FileText className="h-3 w-3" /> },
};

interface ReportBuilderProps {
  title: string;
  onTitleChange: (v: string) => void;
  blocks: ReportBlockRow[];
  branches: BranchOption[];
  onCustom: (doc: RichTextDoc) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onPublish: () => void;
  pending: boolean;
  canPublish: boolean;
}

export function ReportBuilder({
  title,
  onTitleChange,
  blocks,
  branches,
  onCustom,
  onMove,
  onRemove,
  onPublish,
  pending,
  canPublish,
}: ReportBuilderProps) {
  const [customDoc, setCustomDoc] = useState<RichTextDoc>(emptyRichTextDoc());
  const [previewOpen, setPreviewOpen] = useState(false);

  const addCustom = () => {
    const hasContent = JSON.stringify(customDoc).length > 2;
    if (!hasContent) return;
    onCustom(customDoc);
    setCustomDoc(emptyRichTextDoc());
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">Report components</h4>
          <span className="text-xs text-muted">{blocks.length} added</span>
        </div>

        {blocks.length === 0 && (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface px-3 py-4 text-sm text-faint">
            Nothing yet. Add KPI summaries, charts, aggregations, or custom blocks from the
            dataset tabs above.
          </p>
        )}

        {blocks.map((b, i) => {
          const meta = KIND_LABEL[b.kind];
          const branchNames = branches
            .filter((br) => b.branch_ids.includes(br.id))
            .map((br) => br.name);
          return (
            <div key={b.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-subtle px-2 py-0.5 text-xs font-medium text-muted">
                  {meta.icon}
                  {meta.label}
                </span>
                {b.chart_type && (
                  <Badge variant="info">{b.chart_type}</Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{b.title}</span>
                <div className="flex items-center gap-0.5">
                  <Button size="sm" variant="ghost" onClick={() => onMove(i, -1)} disabled={i === 0} title="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onMove(i, 1)}
                    disabled={i === blocks.length - 1}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onRemove(b.id)} title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {branchNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {branchNames.map((n) => (
                    <span key={n} className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-muted">
                      {n}
                    </span>
                  ))}
                </div>
              )}
              <div className="border-t border-border/60 pt-2">
                <ReportBlockBody body={b.body} />
              </div>
            </div>
          );
        })}

        <div className="space-y-1.5">
          <Label htmlFor="block-custom">Custom block</Label>
          <RichTextEditor value={customDoc} onChange={setCustomDoc} placeholder="Write a custom narrative, interpretation, or note…" />
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={addCustom}>
              <Plus className="h-3.5 w-3.5" />
              Add custom block
            </Button>
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <Label htmlFor="report-title">Report title</Label>
          <Input id="report-title" value={title} onChange={(e) => onTitleChange(e.target.value)} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {blocks.length} component{blocks.length === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setPreviewOpen((v) => !v)}
              disabled={blocks.length === 0}
              title="Preview the report exactly as it will be published"
            >
              <Eye className="h-3.5 w-3.5" />
              {previewOpen ? "Hide preview" : "Preview report"}
            </Button>
            <Button variant="primary" onClick={onPublish} disabled={!canPublish}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {blocks.length === 0 ? "Add a component to publish" : "Publish report"}
            </Button>
          </div>
        </div>

        {previewOpen && <ReportPreview title={title} blocks={blocks} branches={branches} />}
      </CardContent>
    </Card>
  );
}