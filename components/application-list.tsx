"use client";

import Link from "next/link";
import { ChevronRight, FileText, FolderOpen } from "lucide-react";
import type { ApplicationListItem } from "@/lib/applications";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

const statusStyle: Record<string, "neutral" | "warning" | "success" | "danger" | "info"> = {
  submitted: "warning",
  processing: "info",
  ready: "success",
  error: "danger",
  archived: "neutral",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ApplicationList({ applications }: { applications: ApplicationListItem[] }) {
  if (applications.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen className="h-6 w-6" />}
        title="No applications yet"
        description="Owners and managers submit pharmacy data files as applications; the analyst reviews them here."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {applications.map((a, i) => (
          <li key={a.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
            <Link href={`/applications/${a.id}`} className="group flex flex-wrap items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-subtle/40 sm:px-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                <FileText className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-foreground group-hover:text-brand">{a.title}</span>
                  <Badge variant={statusStyle[a.status] ?? "neutral"}>{a.status}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  {a.org_name}
                  {a.branch_name ? ` · ${a.branch_name}` : " · org-wide"} · submitted {formatDate(a.created_at)}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5">{a.file_count} file{a.file_count === 1 ? "" : "s"}</span>
                  {a.error_count > 0 && (
                    <span className="rounded-full bg-danger-subtle px-2 py-0.5 text-danger-text">{a.error_count} failed</span>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}