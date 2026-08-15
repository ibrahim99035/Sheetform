"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, RefreshCw, Send, Wand2, Download } from "lucide-react";
import type { ReportDetail } from "@/lib/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { RichTextView } from "@/components/rich-text-view";
import { snapshotKpis, queueDeliveries, retryDeliveries } from "@/lib/actions/reports";

const METRICS = ["revenue", "units", "margin"];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function BodyView({ body }: { body: Record<string, unknown> | null }) {
  if (!body) return <p className="text-sm text-faint">—</p>;
  const entries = Object.entries(body);
  if (entries.length === 0) return <p className="text-sm text-faint">—</p>;

  // { text: "…" } renders as plain paragraphs; { text: <tiptap doc> } renders rich text.
  if ("text" in body && typeof body.text !== "undefined") {
    if (typeof body.text === "string") {
      return <p className="whitespace-pre-wrap text-sm text-foreground">{body.text}</p>;
    }
    if (typeof body.text === "object" && body.text !== null && (body.text as { type?: string }).type === "doc") {
      return <RichTextView doc={body.text as never} />;
    }
  }

  // { series: [...], metric } renders as a compact bar list.
  if (Array.isArray(body.series)) {
    const series = body.series as { bucket?: string; value?: number | null }[];
    const max = Math.max(...series.map((s) => Number(s.value ?? 0)), 1);
    return (
      <div className="space-y-1">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-xs text-muted">{String(s.bucket ?? "")}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-surface-subtle">
              <div
                className="h-full rounded bg-brand/70"
                style={{ width: `${Math.min(100, (Number(s.value ?? 0) / max) * 100)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">
              {s.value?.toLocaleString() ?? "—"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
          <dt className="text-xs text-faint">{k}</dt>
          <dd className="text-sm font-medium tabular-nums text-foreground">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const kindStyle: Record<string, { badge: string; label: string }> = {
  text: { badge: "neutral", label: "Text" },
  chart: { badge: "info", label: "Chart" },
  table: { badge: "info", label: "Table" },
  insight: { badge: "brand", label: "KPI insight" },
};

export function ReportViewer({
  detail,
  isOperator,
  apps,
}: {
  detail: ReportDetail;
  isOperator: boolean;
  apps: { application_id: string; title: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [metric, setMetric] = useState("revenue");
  const [kind, setKind] = useState("email");
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const { report, components, items, deliveries } = detail;

  const runAction = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (pending) return;
    setPending(true);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast({ kind: "error", text: res.error ?? label });
          return;
        }
        toast({ kind: "success", text: label });
        router.refresh();
      } catch (err) {
        toast({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      } finally {
        setPending(false);
      }
    });
  };

  const countBy = (status: string) => deliveries.filter((d) => d.status === status).length;

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">{report.title}</h1>
            <Badge variant={report.status === "published" ? "success" : report.status === "revoked" ? "danger" : "neutral"}>
              {report.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {report.org_name}
            {report.branch_name ? ` · ${report.branch_name}` : " · org-wide"} · published {formatDate(report.published_at)}
            {report.revised_at ? ` · revised ${formatDate(report.revised_at)}` : ""}
          </p>
        </div>
        {isOperator && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href={`/api/reports/${report.id}/export/pdf`}
              title="Export the report as a PDF"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </a>
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
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction("KPIs snapshot.", () => snapshotKpis(report.id, metric))}>
              <Wand2 className="h-3.5 w-3.5" />
              Snapshot KPIs
            </Button>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-subtle/50 px-1.5 py-1">
              <Send className="h-3.5 w-3.5 text-faint" />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                aria-label="Delivery kind"
                className="bg-transparent text-xs text-muted focus:outline-none"
              >
                <option value="email">email</option>
                <option value="whatsapp">whatsapp</option>
              </select>
            </div>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction("Deliveries queued.", () => queueDeliveries(report.id, kind as "email" | "whatsapp"))}>
              <Send className="h-3.5 w-3.5" />
              Queue
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction("Failed deliveries queued for retry.", () => retryDeliveries(report.id))}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Link
              href={`/reports/${report.id}/edit`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
          </div>
        )}
      </div>

      {report.summary && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted">{report.summary}</p>
          </CardContent>
        </Card>
      )}

      {pending && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-brand" />
          Working…
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {components.length === 0 && items.length === 0 && (
            <p className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-sm text-faint">
              This report has no content yet.
            </p>
          )}
          {components.map((c, i) => (
            <Card key={c.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
              <CardContent className="space-y-2.5 pt-4">
                {c.title && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{c.title}</h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={
                          c.visibility === "org" ? "success" : c.visibility === "branch" ? "info" : "danger"
                        }
                        title={
                          c.visibility === "org"
                            ? "Visible to every member"
                            : c.visibility === "branch"
                              ? `Visible to branches ${c.branch_ids.map((b) => b.slice(0, 8)).join(", ")}`
                              : "Exclusive — owners/managers only"
                        }
                      >
                        {c.visibility === "org" ? "Full access" : c.visibility === "branch" ? "Branch" : "Exclusive"}
                      </Badge>
                      <Badge variant={(kindStyle[c.kind]?.badge as never) ?? "neutral"}>
                        {kindStyle[c.kind]?.label ?? c.kind}
                      </Badge>
                    </div>
                  </div>
                )}
                <BodyView body={c.body} />
              </CardContent>
            </Card>
          ))}
          {items.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-foreground">Insight items</h2>
              <div className="space-y-4">
                {items.map((it, i) => (
                  <Card key={it.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                    <CardContent className="space-y-2.5 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{it.title}</h3>
                        <Badge
                          variant={
                            it.visibility === "org" ? "success" : it.visibility === "branch" ? "info" : "danger"
                          }
                        >
                          {it.visibility}
                        </Badge>
                      </div>
                      {it.branch_ids.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {it.branch_ids.map((b) => (
                            <span key={b} className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-muted">
                              {b.slice(0, 8)}
                            </span>
                          ))}
                        </div>
                      )}
                      <BodyView body={it.body} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {apps.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Linked applications</h3>
                <ul className="space-y-1.5">
                  {apps.map((a) => (
                    <li key={a.application_id} className="truncate rounded-lg bg-surface-subtle/60 px-2.5 py-1.5 text-sm text-muted">
                      {a.title}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Deliveries</h3>
              {deliveries.length === 0 ? (
                <p className="text-sm text-faint">No deliveries queued yet.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["delivered", "success"],
                        ["failed", "danger"],
                        ["queued", "warning"],
                        ["processing", "info"],
                        ["skipped", "neutral"],
                      ] as const
                    ).map(([status, variant]) =>
                      countBy(status) > 0 ? (
                        <Badge key={status} variant={variant as never}>
                          {countBy(status)} {status}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                  <ul className="divide-y divide-border/60">
                    {deliveries.slice(0, 10).map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{d.subject ?? d.to_address}</p>
                          <p className="truncate text-xs text-faint">
                            {d.kind} · {d.status}
                            {d.last_error ? ` · ${d.last_error}` : ""}
                          </p>
                        </div>
                        <span className={cn("shrink-0 text-xs tabular-nums text-muted")}>{d.attempt_count}x</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}