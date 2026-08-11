"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileSpreadsheet, FileText, UploadCloud } from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import type { Dataset } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FileIcon({ name }: { name: string }) {
  const isXlsx = /\.xlsx?$/i.test(name);
  const Icon = isXlsx ? FileSpreadsheet : FileText;
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        isXlsx ? "bg-brand-subtle text-brand" : "bg-info-subtle text-info-text",
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

export function DatasetList({ initial }: { initial: Dataset[] }) {
  const supabase = useSupabase();
  const [datasets, setDatasets] = useState<Dataset[]>(initial);

  const upsert = useCallback((record: Dataset) => {
    setDatasets((prev) => {
      const exists = prev.some((d) => d.id === record.id);
      if (!exists) return [record, ...prev];
      return prev.map((d) => (d.id === record.id ? { ...d, ...record } : d));
    });
  }, []);

  const remove = useCallback((id: string) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("datasets-list")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "datasets" },
        (payload) => upsert(payload.new as Dataset),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "datasets" },
        (payload) => upsert(payload.new as Dataset),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "datasets" },
        (payload) => remove((payload.old as Dataset).id),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, upsert, remove]);

  if (datasets.length === 0) {
    return (
      <EmptyState
        icon={<UploadCloud className="h-6 w-6" />}
        title="No datasets yet"
        description="Upload a CSV or Excel file to start browsing, analyzing, and transforming your data."
        action={
          <Link href="/datasets/new" className={buttonClasses("primary", "md")}>
            Upload your first file
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-black/[0.02]">
      <ul className="divide-y divide-border">
        {datasets.map((dataset, i) => (
          <li key={dataset.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
            <Link
              href={`/datasets/${dataset.id}`}
              className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-subtle/70 sm:px-5"
            >
              <FileIcon name={dataset.original_filename} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {dataset.original_filename}
                  {dataset.name !== dataset.original_filename && (
                    <span className="ml-2 text-sm font-normal text-faint">
                      {dataset.name}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {dataset.row_count.toLocaleString()} rows
                  {dataset.sheet_name ? ` · ${dataset.sheet_name}` : ""} ·{" "}
                  {formatDate(dataset.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {dataset.error_message && (
                  <span
                    className="hidden max-w-[220px] truncate text-sm text-danger-text md:inline"
                    title={dataset.error_message}
                  >
                    {dataset.error_message}
                  </span>
                )}
                <StatusBadge status={dataset.status} />
                <ChevronRight className="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
