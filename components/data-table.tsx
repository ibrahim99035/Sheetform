"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AgGridReact } from "ag-grid-react";
import type {
  BodyScrollEvent,
  CellValueChangedEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
} from "ag-grid-community";
import { Inbox, Loader2 } from "lucide-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { useSupabase } from "@/lib/supabase/provider";
import { fetchRowCount, fetchRows } from "@/lib/dataset-api";
import type { DataStore } from "@/lib/datastore";
import { ESTIMATED_ROW_HEIGHT, TABLE_WINDOW_SIZE } from "@/lib/constants";
import { formatCellValue, formatDateCell, viewSignature } from "@/lib/view";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { ColumnDef, SortDirection, ViewState } from "@/lib/types";

interface DataTableProps {
  datasetId: string;
  columns: ColumnDef[];
  view: ViewState;
  onViewChange: (view: ViewState) => void;
  onCommitCell: (rowId: number, columnKey: string, rawValue: string) => void;
  /** Local-first store (DuckDB+OPFS). Omit to stay on the server RPC path. */
  store?: DataStore;
}

interface GridRow {
  __r_id: number;
  __r_index: number;
  [key: string]: unknown;
}

export function DataTable({
  datasetId,
  columns,
  view,
  onViewChange,
  onCommitCell,
  store,
}: DataTableProps) {
  const supabase = useSupabase();
  const sig = viewSignature(view);
  const engine = store?.engine ?? "supabase";

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
    useInfiniteQuery({
      queryKey: ["rows", datasetId, engine, sig],
      queryFn: ({ pageParam }) =>
        store
          ? store.fetchRows(datasetId, view, TABLE_WINDOW_SIZE, pageParam)
          : fetchRows(supabase, datasetId, view, TABLE_WINDOW_SIZE, pageParam),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        if (lastPage.length < TABLE_WINDOW_SIZE) return undefined;
        return allPages.reduce((n, p) => n + p.length, 0);
      },
    });

  const { data: count } = useQuery({
    queryKey: ["row-count", datasetId, engine, sig],
    queryFn: () =>
      store ? store.fetchRowCount(datasetId, view) : fetchRowCount(supabase, datasetId, view),
  });

  const gridRows = useMemo<GridRow[]>(
    () =>
      (data?.pages.flatMap((p) => p) ?? []).map((r) => ({
        __r_id: r.row_id,
        __r_index: r.row_index,
        ...r.data,
      })),
    [data],
  );

  const colDefs = useMemo<ColDef[]>(
    () =>
      columns.map((c) => ({
        field: c.key,
        headerName: c.label,
        headerTooltip: `${c.label} · ${c.type}`,
        sortable: true,
        resizable: true,
        suppressHeaderMenuButton: true,
        minWidth: c.type === "numeric" ? 120 : 170,
        width: c.type === "numeric" ? 120 : 200,
        editable: true,
        valueFormatter:
          c.type === "date"
            ? (p) => (p.value == null ? "" : formatDateCell(p.value))
            : (p) =>
                p.value === null || p.value === undefined
                  ? ""
                  : formatCellValue(p.value, c.type),
      })),
    [columns],
  );

  const apiRef = useRef<GridApi | null>(null);
  // Keep the latest view/sort in a ref so the AG Grid handlers never go stale.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const onGridReady = (e: GridReadyEvent) => {
    apiRef.current = e.api;
  };

  const onSortChanged = () => {
    const api = apiRef.current;
    if (!api) return;
    const model = api.getColumnState().filter((s) => s.sort);
    const current = viewRef.current;
    let nextSort: ViewState["sort"] = null;
    if (model.length > 0) {
      const m = model[0];
      nextSort = { key: m.colId, dir: m.sort === "desc" ? "desc" : "asc" };
    }
    if (JSON.stringify(nextSort) !== JSON.stringify(current.sort)) {
      onViewChange({ ...current, sort: nextSort });
    }
  };

  const onCellValueChanged = (e: CellValueChangedEvent<GridRow>) => {
    const rowId = Number(e.data?.__r_id);
    if (!Number.isFinite(rowId)) return;
    const key = e.colDef.field ?? "";
    if (!key) return;
    const raw = e.newValue;
    onCommitCell(rowId, key, raw === null || raw === undefined ? "" : String(raw));
  };

  const onBodyScroll = (e: BodyScrollEvent) => {
    const last = e.api.getLastDisplayedRowIndex();
    const total = e.api.getDisplayedRowCount();
    if (last >= total - 30 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex h-[55vh] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02] sm:h-[62vh]">
        {isLoading ? (
          <TableSkeleton numColumns={columns.length} />
        ) : isError ? (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={<Inbox className="h-6 w-6" />}
              title="Could not load this dataset"
              description="Switch back to the server engine or retry the import."
            />
          </div>
        ) : gridRows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
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
          <div className="ag-theme-quartz h-full min-h-0">
            <AgGridReact<GridRow>
              rowData={gridRows}
              columnDefs={colDefs}
              onGridReady={onGridReady}
              getRowId={(p) => String(p.data.__r_id)}
              onSortChanged={onSortChanged}
              onCellValueChanged={onCellValueChanged}
              onBodyScroll={onBodyScroll}
              headerHeight={38}
              rowHeight={ESTIMATED_ROW_HEIGHT}
              suppressMenuHide
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted">
        <span>
          {count !== undefined && (
            <span className="font-medium text-foreground">{count.toLocaleString()}</span>
          )}{" "}
          {count !== undefined && `row${count === 1 ? "" : "s"}`}
          {count !== undefined && view.filters.length > 0 && " filtered"}
          {engine === "duckdb" && <span className="ml-2 text-faint">· local engine</span>}
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
          className="flex items-center border-b border-border/60 px-3"
          style={{ height: ESTIMATED_ROW_HEIGHT }}
        >
          {Array.from({ length: Math.min(numColumns, 8) }).map((_, c) => (
            <Skeleton key={c} className="mr-4 h-2.5" style={{ width: `${55 + ((r * 7 + c * 13) % 40)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}