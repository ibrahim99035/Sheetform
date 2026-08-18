"use client";

import { useCallback, useState, useTransition } from "react";
import { Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownView } from "@/components/markdown-view";
import { runDatasetAnalysis, type AnalysisActionResult } from "@/lib/actions/analysis";
import type { AnalysisReport } from "@/lib/analysis/types";
import type { ReportBlockContent } from "@/lib/actions/report-blocks";

interface EngineTabProps {
  datasetId: string;
  datasetName: string;
  initialReport: AnalysisReport | null;
  onAddBlock?: (block: ReportBlockContent) => void;
}

export function EngineTab({ datasetId, datasetName, initialReport, onAddBlock }: EngineTabProps) {
  const { toast } = useToast();
  const [report, setReport] = useState<AnalysisReport | null>(initialReport);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const handleRun = useCallback(() => {
    if (pending) return;
    setPending(true);
    startTransition(async () => {
      try {
        const res: AnalysisActionResult = await runDatasetAnalysis(datasetId);
        if (!res.ok) {
          toast({ kind: "error", text: res.error ?? "Analysis failed" });
          return;
        }
        if (res.report) setReport(res.report);
        toast({ kind: "success", text: "Analysis generated." });
      } catch (e) {
        toast({ kind: "error", text: e instanceof Error ? e.message : "Analysis failed" });
      } finally {
        setPending(false);
      }
    });
  }, [datasetId, pending, toast]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">SiroQ Analysis Engine</h3>
            <p className="mt-0.5 text-sm text-muted">
              Runs a deterministic analytic pass over {datasetName} — role resolution, data
              quality, metrics, and action-oriented insights. No LLM involved; confidence is
              derived from schema confidence × role coverage × sample size.
            </p>
          </div>
          <Button onClick={handleRun} disabled={pending} variant="primary" size="sm">
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {report ? "Re-run analysis" : "Run analysis"}
          </Button>
        </CardContent>
      </Card>

      {pending && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-brand" />
          Computing metrics, quality profile, and insights…
        </div>
      )}

      {!pending && !report && (
        <p className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-sm text-faint">
          No analysis yet. Run the engine to generate a report.
        </p>
      )}

      {report && (
        <Card className="animate-fade-in">
          <CardContent className="overflow-x-auto pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-brand/25 bg-brand-subtle px-2.5 py-0.5 text-xs font-medium text-brand">
                {report.dataQuality.score}/100 · {report.dataQuality.grade}
              </span>
              <span className="rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
                sensitivity: {report.sensitivity}
              </span>
              <span className="rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
                {report.mode}
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs text-faint">
                <Wand2 className="h-3 w-3" />
                generated {new Date(report.generatedAt).toLocaleString()}
              </span>
              {onAddBlock && (
                <Button size="sm" variant="secondary" onClick={() => onAddBlock({
                  kind: "insight",
                  title: `Analysis — ${datasetName}`,
                  body: { markdown: report.markdown },
                  chartType: null,
                  branchIds: [],
                })} title="Add the analysis narrative to the report">
                  <Plus className="h-3.5 w-3.5" />
                  Add to report
                </Button>
              )}
            </div>
            <MarkdownView markdown={report.markdown} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}