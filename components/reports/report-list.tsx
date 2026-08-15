"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, Loader2, RefreshCw, Send, Wand2 } from "lucide-react";
import type { ReportListItem } from "@/lib/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  snapshotKpis,
  queueDeliveries,
  retryDeliveries,
} from "@/lib/actions/reports";

const METRICS = ["revenue", "units", "margin"];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusPill({ status }: { status: ReportListItem["status"] }) {
  if (status === "published") return <Badge variant="success">Published</Badge>;
  if (status === "revoked") return <Badge variant="danger">Revoked</Badge>;
  return <Badge variant="neutral">Draft</Badge>;
}

function DeliverySummary({ counts }: { counts: ReportListItem["delivery_counts"] }) {
  if (!counts) return <span className="text-xs text-faint">No deliveries</span>;
  const parts: ReactNode[] = [];
  if (counts.delivered) parts.push(`${counts.delivered} sent`);
  if (counts.queued) parts.push(`${counts.queued} queued`);
  if (counts.failed)
    parts.push(
      <span key="f" className="font-medium text-danger-text">
        {counts.failed} failed
      </span>,
    );
  if (parts.length === 0) return <span className="text-xs text-faint">No deliveries</span>;
  return <span className="text-xs text-muted">{parts}</span>;
}

interface RowActionsProps {
  report: ReportListItem;
  onAction: (action: () => Promise<void>) => void;
}

function RowActions({ report, onAction }: RowActionsProps) {
  const [metric, setMetric] = useState("revenue");
  const [kind, setKind] = useState("both");

  const snapshot = () =>
    onAction(async () => {
      const res = await snapshotKpis(report.id, metric);
      if (!res.ok) throw new Error(res.error);
    });

  const queue = () =>
    onAction(async () => {
      const res = await queueDeliveries(report.id, kind === "both" ? null : (kind as "email" | "whatsapp"));
      if (!res.ok) throw new Error(res.error);
    });

  const retry = () =>
    onAction(async () => {
      const res = await retryDeliveries(report.id);
      if (!res.ok) throw new Error(res.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-subtle/50 px-1.5 py-1">
        <Wand2 className="h-3.5 w-3.5 text-faint" />
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label="Metric"
          className="bg-transparent text-xs text-muted focus:outline-none"
        >
          {METRICS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <Button size="sm" variant="ghost" onClick={snapshot} title="Snapshot KPIs into the report">
        <Wand2 className="h-3.5 w-3.5" />
        Snapshot
      </Button>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-subtle/50 px-1.5 py-1">
        <Send className="h-3.5 w-3.5 text-faint" />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Delivery kind"
          className="bg-transparent text-xs text-muted focus:outline-none"
        >
          <option value="both">both</option>
          <option value="email">email</option>
          <option value="whatsapp">whatsapp</option>
        </select>
      </div>
      <Button size="sm" variant="ghost" onClick={queue} title="Queue deliveries">
        <Send className="h-3.5 w-3.5" />
        Queue
      </Button>
      <Button size="sm" variant="ghost" onClick={retry} title="Re-queue failed deliveries">
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    </div>
  );
}

export function ReportList({
  reports,
  isOperator,
}: {
  reports: ReportListItem[];
  isOperator: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const runAction = (fn: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    startTransition(async () => {
      try {
        await fn();
        toast({ kind: "success", text: "Done." });
        router.refresh();
      } catch (err) {
        toast({
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPending(false);
      }
    });
  };

  if (reports.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-6 w-6" />}
        title="No reports yet"
        description={
          isOperator
            ? "Create your first report for an organization — insights, KPIs, and deliveries all start here."
            : "Published reports for your organization will appear here."
        }
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {reports.map((report, i) => (
          <li key={report.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <Link href={`/reports/${report.id}`} className="group flex items-center gap-2">
                  <span className="truncate font-medium text-foreground group-hover:text-brand">
                    {report.title}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted" />
                </Link>
                <p className="mt-0.5 text-sm text-muted">
                  {report.org_name}
                  {report.branch_name ? ` · ${report.branch_name}` : " · org-wide"} · published{" "}
                  {formatDate(report.published_at ?? report.created_at)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusPill status={report.status} />
                  <DeliverySummary counts={report.delivery_counts} />
                </div>
              </div>
              {isOperator && (
                <div className={cn("shrink-0", pending && "pointer-events-none opacity-50")}>
                  <RowActions report={report} onAction={runAction} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {pending && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Working…
        </div>
      )}
    </Card>
  );
}