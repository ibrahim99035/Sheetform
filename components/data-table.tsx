"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase/provider";
import { fetchRowCount, fetchRows } from "@/lib/dataset-api";
import { ESTIMATED_ROW_HEIGHT, TABLE_WINDOW_SIZE } from "@/lib/constants";
import { formatCellValue, formatDateCell, viewSignature } from "@/lib/view";
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

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
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
    <div>
      <div
        ref={parentRef}
        className="h-[62vh] overflow-auto rounded-xl border border-neutral-200 bg-white"
      >
        <div className="sticky top-0 z-10 flex w-max min-w-full border-b border-neutral-200 bg-neutral-50 shadow-sm">
          <div
            className="flex shrink-0 items-center px-3 text-xs font-semibold text-neutral-400"
            style={{ width: NUM_WIDTH }}
          >
            #
          </div>
          {columns.map((column) => {
            const active = view.sort?.key === column.key;
            return (
              <div
                key={column.key}
                className="flex shrink-0 cursor-pointer select-none items-center gap-1 border-l border-neutral-200 px-3"
                style={{ width: COL_WIDTH }}
                onClick={() => toggleSort(column.key)}
                title="Click to sort"
              >
                <span className="truncate text-xs font-semibold text-neutral-700">
                  {column.label}
                </span>
                <span className="text-[10px] font-normal text-neutral-400">
                  {column.type}
                </span>
                <span className="whitespace-nowrap text-xs text-neutral-500">
                  {active ? (view.sort!.dir === "asc" ? "↑" : "↓") : ""}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative", width: "max-content" }}
        >
          {virtualItems.map((virtualRow) => {
            const item = items[virtualRow.index];
            if (!item) return null;
            return (
              <div
                key={item.row_id}
                className="absolute left-0 top-0 flex items-stretch border-b border-neutral-100 hover:bg-neutral-50"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className="flex shrink-0 items-center border-r border-neutral-100 bg-neutral-50/60 px-3 text-sm text-neutral-400"
                  style={{ width: NUM_WIDTH }}
                >
                  {item.row_index}
                </div>
                {columns.map((column) => {
                  const value = item.data[column.key];
                  const isEditing =
                    editing && editing.rowId === item.row_id && editing.key === column.key;
                  const nullish = value === null || value === undefined;
                  const cellClassName = `flex shrink-0 items-center overflow-hidden border-r border-neutral-100 px-3 text-sm ${
                    column.type === "numeric"
                      ? "justify-end tabular-nums text-neutral-900"
                      : "text-neutral-800"
                  } ${nullish ? "text-neutral-300" : ""}`;
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
                          className="w-full rounded border border-neutral-400 px-1.5 py-0.5 text-sm outline-none"
                        />
                      ) : (
                        <span className="truncate text-neutral-800">
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
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {count !== undefined &&
            `${count.toLocaleString()} row${count === 1 ? "" : "s"}`}
          {count !== undefined && view.filters.length > 0 && " filtered"}
        </span>
        <span>
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