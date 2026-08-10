"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSupabase } from "@/lib/supabase/provider";
import type { Dataset } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-12 text-center">
        <p className="text-neutral-600">No datasets yet.</p>
        <Link
          href="/datasets/new"
          className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Upload your first file
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
      {datasets.map((dataset) => (
        <li key={dataset.id}>
          <Link
            href={`/datasets/${dataset.id}`}
            className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-neutral-50"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-neutral-900">
                {dataset.original_filename}
                {dataset.name !== dataset.original_filename && (
                  <span className="ml-2 text-sm font-normal text-neutral-400">
                    {dataset.name}
                  </span>
                )}
              </p>
              <p className="text-sm text-neutral-500">
                {dataset.row_count.toLocaleString()} rows
                {dataset.sheet_name ? ` · ${dataset.sheet_name}` : ""} ·{" "}
                {formatDate(dataset.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {dataset.error_message && (
                <span
                  className="hidden max-w-[220px] truncate text-sm text-red-600 md:inline"
                  title={dataset.error_message}
                >
                  {dataset.error_message}
                </span>
              )}
              <StatusBadge status={dataset.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}