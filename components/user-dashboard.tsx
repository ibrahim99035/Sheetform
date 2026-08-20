"use client";

import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Building2,
  FolderOpen,
  Plus,
  TrendingUp,
} from "lucide-react";
import type { Dataset } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

export function UserDashboard({
  datasets,
  orgId,
}: {
  datasets: Dataset[];
  orgId: string | null;
}) {
  const readyCount = datasets.filter((d) => d.status === "ready").length;
  const totalRows = datasets.reduce((sum, d) => sum + (d.row_count ?? 0), 0);

  return (
    <div className="animate-slide-up space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted">Welcome back. Here&apos;s your overview.</p>
        </div>
        <div className="flex items-center gap-2">
          {orgId && (
            <Link
              href={`/org/${orgId}`}
              className={buttonClasses("secondary", "md")}
            >
              <Building2 className="h-4 w-4" />
              Organization
            </Link>
          )}
          <Link href="/datasets/new" className={buttonClasses("primary", "md")}>
            <Plus className="h-4 w-4" />
            New dataset
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <FolderOpen className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-foreground">{datasets.length}</p>
              <p className="text-xs text-muted">Total datasets</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-foreground">{totalRows.toLocaleString()}</p>
              <p className="text-xs text-muted">Total rows imported</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-foreground">{readyCount}/{datasets.length}</p>
              <p className="text-xs text-muted">Ready datasets</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent datasets</CardTitle>
        </CardHeader>
        <CardContent>
          {datasets.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FolderOpen className="h-10 w-10 text-faint" />
              <p className="text-sm text-muted">No datasets yet. Upload your first file to get started.</p>
              <Link href="/datasets/new" className={buttonClasses("primary", "md")}>
                <Plus className="h-4 w-4" />
                New dataset
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">File</th>
                    <th className="px-4 py-2.5 text-right">Rows</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {datasets.slice(0, 5).map((ds) => (
                    <tr key={ds.id} className="transition-colors hover:bg-surface-subtle/40">
                      <td className="px-4 py-2.5 font-medium text-foreground">{ds.name}</td>
                      <td className="px-4 py-2.5 text-muted">{ds.original_filename}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {(ds.row_count ?? 0).toLocaleString()}
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
          )}
          {datasets.length > 5 && (
            <div className="mt-3 text-center">
              <Link
                href="/datasets"
                className="text-sm font-medium text-brand transition hover:underline"
              >
                View all datasets →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              href="/datasets/new"
              className="group flex items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/30 hover:bg-surface-subtle/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand transition group-hover:bg-brand group-hover:text-white">
                <Plus className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">New dataset</p>
                <p className="text-xs text-muted">Upload CSV or Excel</p>
              </div>
            </Link>
            <Link
              href="/training"
              className="group flex items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/30 hover:bg-surface-subtle/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand transition group-hover:bg-brand group-hover:text-white">
                <BookOpen className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">Training</p>
                <p className="text-xs text-muted">Learn the 9 services</p>
              </div>
            </Link>
            <Link
              href="/reports"
              className="group flex items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/30 hover:bg-surface-subtle/40"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand transition group-hover:bg-brand group-hover:text-white">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">Reports</p>
                <p className="text-xs text-muted">View and create reports</p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
