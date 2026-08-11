"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, Loader2 } from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import { fetchRowCount, fetchRows } from "@/lib/dataset-api";
import { ESTIMATED_ROW_HEIGHT, TABLE_WINDOW_SIZE } from "@/lib/constants";
import { formatCellValue, formatDateCell, viewSignature } from "@/lib/view";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import type { ColumnDef, SortDirection, ViewState } from "@/lib/types";

const COL_WIDTH = 200;
const NUM_WIDTH = 60;

interface DataTableProps {
  datasetId: string;
  columns: ColumnDef[];
  view: ViewState;
  onViewChange: (view: ViewState) => void;
  onCommitCell: (rowId: number, columnKey: string, rawValue: string) => void;
}

export function DataTable({
  datasetId,
  columns,
  view,
  onViewChange,
  onCommitCell,
}: DataTableProps) {
  const supabase = useSupabase();
  const sig = viewSignature(view);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["rows", datasetId, sig],
    queryFn: ({ pageParam }) =>
      fetchRows(supabase, datasetId, view, TABLE_WINDOW_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < TABLE_WINDOW_SIZE) return undefined;
      return allPages.reduce((n, p) => n + p.length, 0);
    },
  });

  const { data: count } = useQuery({
    queryKey: ["row-count", datasetId, sig],
    queryFn: () => fetchRowCount(supabase, datasetId, view),
  });

  const items = useMemo(() => data?.pages.flatMap((p) => p) ?? [], [data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: Math.max(items.length, 1),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 12,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? 0;

  useEffect(() => {
    if (items.length - lastIndex < 40 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [lastIndex, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const [editing, setEditing] = useState<{
    rowId: number;
    key: string;
    value: string;
  } | null>(null);

  const startEdit = (rowId: number, columnKey: string, current: unknown) => {
    setEditing({
      rowId,
      key: columnKey,
      value: current === null || current === undefined ? "" : String(current),
    });
  };

  const commitEdit = () => {
    if (!editing) return;
    onCommitCell(editing.rowId, editing.key, editing.value);
    setEditing(null);
  };

  const toggleSort = (key: string) => {
    let nextSort: ViewState["sort"] = { key, dir: "asc" as SortDirection };
    if (view.sort?.key === key && view.sort.dir === "asc") {
      nextSort = { key, dir: "desc" };
    } else if (view.sort?.key === key) {
      nextSort = null;
    }
    onViewChange({ ...view, sort: nextSort });
  };

  return (
    <div className="space-y-2">
      <div
        ref={parentRef}
        className="h-[62vh] overflow-auto rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02]"
      >
        <div className="sticky top-0 z-10 flex w-max min-w-full border-b border-border bg-surface-subtle/90 backdrop-blur-sm">
          <div
            className="flex shrink-0 items-center px-3 font-mono text-[11px] font-medium text-faint"
            style={{ width: NUM_WIDTH }}
          >
            #
          </div>
          {columns.map((column) => {
            const active = view.sort?.key === column.key;
            return (
              <div
                key={column.key}
                className="group flex shrink-0 cursor-pointer select-none items-center gap-2 border-l border-border px-3 transition-colors hover:bg-surface-subtle"
                style={{ width: COL_WIDTH }}
                onClick={() => toggleSort(column.key)}
                title="Click to sort"
              >
                <span className="truncate text-xs font-semibold text-foreground">
                  {column.label}
                </span>
                <span className="rounded bg-background/60 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-faint">
                  {column.type}
                </span>
                {active ? (
                  view.sort!.dir === "asc" ? (
                    <ArrowUp className="ml-auto h-3 w-3 shrink-0 text-brand" />
                  ) : (
                    <ArrowDown className="ml-auto h-3 w-3 shrink-0 text-brand" />
                  )
                ) : (
                  <ArrowUpDown className="ml-auto h-3 w-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </div>
            );
          })}
        </div>

        {isLoading ? (
          <TableSkeleton numColumns={columns.length} />
        ) : items.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center p-8">
            <EmptyState
              icon={<Inbox className="h-6 w-6" />}
              title={count === 0 ? "No rows in this dataset" : "No rows match the current filter"}
              description={
                count === 0
                  ? "Import data to start working with it."
                  : "Try clearing the active view filter to see more rows."
              }
            />
          </div>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative", width: "max-content" }}
          >
            {virtualItems.map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.row_id}
                  className="absolute left-0 top-0 flex items-stretch border-b border-border/60 transition-colors hover:bg-surface-subtle/50"
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div
                    className="flex shrink-0 items-center border-r border-border bg-surface-subtle/50 px-3 font-mono text-xs text-faint"
                    style={{ width: NUM_WIDTH }}
                  >
                    {item.row_index}
                  </div>
                  {columns.map((column) => {
                    const value = item.data[column.key];
                    const isEditing =
                      editing && editing.rowId === item.row_id && editing.key === column.key;
                    const nullish = value === null || value === undefined;
                    const cellClassName = cn(
                      "flex shrink-0 items-center overflow-hidden border-r border-border/60 px-3 text-sm",
                      column.type === "numeric" && "justify-end tabular-nums text-foreground",
                      !nullish && column.type !== "numeric" && "text-foreground",
                      nullish && "text-faint",
                    );
                    return (
                      <div
                        key={column.key}
                        className={cellClassName}
                        style={{ width: COL_WIDTH }}
                        onDoubleClick={() => startEdit(item.row_id, column.key, value)}
                        title="Double-click to edit"
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editing!.value}
                            onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            onBlur={commitEdit}
                            className="w-full rounded-md border border-brand bg-surface px-1.5 py-1 text-sm text-foreground shadow-sm outline-none"
                          />
                        ) : (
                          <span className="truncate">
                            {column.type === "date" && !nullish
                              ? formatDateCell(value)
                              : formatCellValue(value, column.type)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>
          {count !== undefined && (
            <span className="font-medium text-foreground">
              {count.toLocaleString()}
            </span>
          )}{" "}
          {count !== undefined && `row${count === 1 ? "" : "s"}`}
          {count !== undefined && view.filters.length > 0 && " filtered"}
        </span>
        <span className="flex items-center gap-1.5">
          {isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin text-brand" />}
          {isFetchingNextPage
            ? "Loading more…"
            : hasNextPage
              ? "Scroll to load more"
              : "All rows loaded"}
        </span>
      </div>
    </div>
  );
}

function TableSkeleton({ numColumns }: { numColumns: number }) {
  return (
    <div className="p-0">
      {Array.from({ length: 12 }).map((_, r) => (
        <div
          key={r}
          className="flex items-center border-b border-border/60"
          style={{ height: ESTIMATED_ROW_HEIGHT }}
        >
          <div className="shrink-0 px-3" style={{ width: NUM_WIDTH }}>
            <Skeleton className="h-2.5 w-6" />
          </div>
          {Array.from({ length: Math.min(numColumns, 6) }).map((_, c) => (
            <div key={c} className="shrink-0 px-3" style={{ width: COL_WIDTH }}>
              <Skeleton className="h-2.5" style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
