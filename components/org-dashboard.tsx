"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  FileText,
  FolderOpen,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import type { OrgDashboardData } from "@/lib/actions/org-dashboard";
import type { ServiceCoverage } from "@/lib/analysis/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";

type Tab = "overview" | string;

function KpiStrip({ kpis }: { kpis: OrgDashboardData["kpis"] }) {
  const items = [
    {
      icon: FolderOpen,
      label: "Datasets",
      value: kpis.totalDatasets,
      sub: `${kpis.readyDatasets} ready`,
    },
    {
      icon: FileText,
      label: "Total rows",
      value: kpis.totalRows.toLocaleString(),
      sub: "imported",
    },
    {
      icon: TrendingUp,
      label: "Services",
      value: `${kpis.servicesReady}/${kpis.servicesTotal}`,
      sub: "available",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <item.icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-foreground">{item.value}</p>
              <p className="text-xs text-muted">
                {item.label} · {item.sub}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ServiceGrid({ coverage }: { coverage: ServiceCoverage[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {coverage.map((svc) => (
        <div
          key={svc.id}
          className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm transition ${
            svc.available
              ? "border-success/25 bg-success-subtle/30"
              : "border-border bg-surface-subtle"
          }`}
        >
          {svc.available ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 text-danger" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">{svc.name}</span>
              <span className="text-xs text-muted">{svc.nameAr}</span>
            </div>
              {svc.available ? (
              <p className="mt-0.5 text-xs text-success">Ready</p>
            ) : (
              <>
                <div className="mt-1 flex flex-wrap gap-1">
                  {svc.missing.map((m) => (
                    <span
                      key={m.role}
                      className="inline-block rounded-full border border-danger/25 bg-danger-subtle px-2 py-0.5 text-[10px] font-medium text-danger-text"
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
                <Link
                  href={`/training/${svc.id}-analysis`}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand transition hover:underline"
                >
                  <BookOpen className="h-3 w-3" />
                  Learn how
                </Link>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function DatasetTable({ datasets }: { datasets: OrgDashboardData["datasets"] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Dataset</th>
              <th className="px-4 py-2.5">File</th>
              <th className="px-4 py-2.5 text-right">Rows</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {datasets.map((ds) => (
              <tr key={ds.id} className="transition-colors hover:bg-surface-subtle/40">
                <td className="px-4 py-2.5 font-medium text-foreground">{ds.name}</td>
                <td className="px-4 py-2.5 text-muted">{ds.original_filename}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                  {ds.row_count.toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <Badge
                    variant={
                      ds.status === "ready"
                        ? "success"
                        : ds.status === "error"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {ds.status}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/datasets/${ds.id}`}
                    className="text-xs font-medium text-brand transition hover:underline"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrgDashboard({ data }: { data: OrgDashboardData }) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs = useMemo(
    () => [
      { value: "overview", label: "Overview", icon: <BarChart3 className="h-3.5 w-3.5" /> },
      { value: "datasets", label: "Datasets", icon: <FolderOpen className="h-3.5 w-3.5" /> },
      ...data.mergedCoverage
        .filter((s) => s.available)
        .map((s) => ({
          value: s.id,
          label: s.name,
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        })),
    ],
    [data.mergedCoverage],
  );

  return (
    <div className="animate-slide-up space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{data.organization.name}</h1>
        <p className="mt-0.5 text-sm text-muted">
          Organization dashboard · {data.datasets.length} dataset{data.datasets.length !== 1 ? "s" : ""}
        </p>
      </div>

      <KpiStrip kpis={data.kpis} />

      <Tabs value={tab} onChange={setTab} items={tabs} />

      {tab === "overview" && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Service availability</CardTitle>
            </CardHeader>
            <CardContent>
              <ServiceGrid coverage={data.mergedCoverage} />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "datasets" && <DatasetTable datasets={data.datasets} />}

      {tab !== "overview" && tab !== "datasets" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <BarChart3 className="h-8 w-8 text-faint" />
            <p className="text-sm text-muted">
              The <strong>{data.mergedCoverage.find((s) => s.id === tab)?.name}</strong> lens
              will render here using merged data across all datasets.
            </p>
            <p className="text-xs text-faint">
              Per-service lens panels are coming in a follow-up iteration.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
