"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/lib/supabase/provider";
import { DataTable } from "@/components/data-table";
import { AnalyzeTab } from "@/components/analyze-tab";
import { ActivityTab } from "@/components/activity-tab";
import { StatusBadge } from "@/components/status-badge";
import { applyOperation, redoOperation, undoOperation } from "@/lib/dataset-api";
import { makeStorageKey, coerceValue } from "@/lib/coerce";
import { viewSignature } from "@/lib/view";
import type {
  ColumnStats,
  Dataset,
  FilterOp,
  FilterSpec,
  Operation,
  ViewState,
} from "@/lib/types";

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ or equal" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ or equal" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

type Tab = "data" | "analyze" | "activity";

interface WorkspaceProps {
  dataset: Dataset;
  initialStats: ColumnStats[];
  initialOps: Operation[];
}

export function DatasetWorkspace({ dataset, initialStats, initialOps }: WorkspaceProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [ds, setDs] = useState<Dataset>(dataset);
  const [tab, setTab] = useState<Tab>("data");
  const [view, setView] = useState<ViewState>({ sort: null, filters: [] });
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyOp, setBusyOp] = useState<string | null>(null);

  const columns = ds.column_defs;
  const activeFilters = view.filters.length > 0;
  const sig = viewSignature(view);

  const invalidateDataset = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["rows", ds.id] });
    queryClient.invalidateQueries({ queryKey: ["row-count", ds.id] });
    queryClient.invalidateQueries({ queryKey: ["stats", ds.id] });
    queryClient.invalidateQueries({ queryKey: ["ops", ds.id] });
    queryClient.invalidateQueries({ queryKey: ["groupby", ds.id] });
  }, [queryClient, ds.id]);

  // Real-time status sync during/after import
  useEffect(() => {
    const channel = supabase
      .channel(`dataset-${ds.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "datasets",
          filter: `id=eq.${ds.id}`,
        },
        (payload) => {
          const record = payload.new as Dataset;
          setDs((prev) => ({ ...prev, ...record }));
          if (record.status === "ready") {
            invalidateDataset();
            setNotice({ kind: "ok", text: "Import finished." });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "datasets", filter: `id=eq.${ds.id}` },
        () => router.push("/datasets"),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, ds.id, invalidateDataset, router]);

  const runOp = useCallback(
    async (operation: string, params: Record<string, unknown>, okMessage?: string) => {
      setBusyOp(operation);
      setNotice(null);
      try {
        const res = await applyOperation(supabase, ds.id, operation, params);
        if (!res.ok) {
          setNotice({ kind: "err", text: res.error ?? "Operation failed" });
          return;
        }
        invalidateDataset();
        setNotice({ kind: "ok", text: okMessage ?? res.message ?? "Done" });
      } catch (e) {
        setNotice({ kind: "err", text: e instanceof Error ? e.message : "Operation failed" });
      } finally {
        setBusyOp(null);
      }
    },
    [supabase, ds.id, invalidateDataset],
  );

  const handleCommitCell = useCallback(
    async (rowId: number, columnKey: string, rawValue: string) => {
      const column = ds.column_defs.find((c) => c.key === columnKey);
      const value = coerceValue(column?.type ?? "string", rawValue === "" ? null : rawValue);
      await runOp(
        "edit_cell",
        { row_id: rowId, column_key: columnKey, new_value: value },
        "Cell updated",
      );
    },
    [runOp, ds.column_defs],
  );

  const handleUndo = useCallback(async () => {
    setBusyOp("undo");
    const res = await undoOperation(supabase, ds.id);
    setBusyOp(null);
    if (!res.ok) {
      setNotice({ kind: "err", text: res.error ?? "Nothing to undo" });
      return;
    }
    invalidateDataset();
    setNotice({ kind: "ok", text: "Undid last operation" });
  }, [supabase, ds.id, invalidateDataset]);

  const handleRedo = useCallback(async () => {
    setBusyOp("redo");
    const res = await redoOperation(supabase, ds.id);
    setBusyOp(null);
    if (!res.ok) {
      setNotice({ kind: "err", text: res.error ?? "Nothing to redo" });
      return;
    }
    invalidateDataset();
    setNotice({ kind: "ok", text: "Redid operation" });
  }, [supabase, ds.id, invalidateDataset]);

  // ---- filter bar state ----
  const [filterDraft, setFilterDraft] = useState<{ key: string; op: FilterOp; value: string }>({
    key: columns[0]?.key ?? "",
    op: "contains",
    value: "",
  });

  const addFilter = () => {
    if (!filterDraft.key || !columns.find((c) => c.key === filterDraft.key)) return;
    const col = columns.find((c) => c.key === filterDraft.key);
    const compareOps = ["gt", "gte", "lt", "lte", "equals", "not_equals"];
    if (compareOps.includes(filterDraft.op)) {
      if (col?.type === "numeric" && !/^-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(filterDraft.value)) {
        setNotice({ kind: "err", text: "Enter a valid number for this filter." });
        return;
      }
      if (col?.type === "date" && isNaN(Date.parse(filterDraft.value))) {
        setNotice({ kind: "err", text: "Enter a valid date for this filter." });
        return;
      }
    }
    const spec: FilterSpec = { ...filterDraft };
    if (spec.op === "is_empty" || spec.op === "is_not_empty") spec.value = "";
    setView((v) => ({ ...v, filters: [...v.filters, spec] }));
    setFilterDraft({ ...filterDraft, value: "" });
    setNotice(null);
  };

  const removeFilter = (index: number) => {
    setView((v) => ({ ...v, filters: v.filters.filter((_, i) => i !== index) }));
  };

  const deleteMatchingRows = () => {
    if (!activeFilters) return;
    runOp(
      "filter_rows",
      { filters: view.filters, label: `${view.filters.length} filter(s)` },
      "Rows removed (undo available)",
    );
  };

  // ---- transform dialogs ----
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameCol, setRenameCol] = useState(columns[0]?.key ?? "");
  const [renameLabel, setRenameLabel] = useState("");
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [dedupeColumns, setDedupeColumns] = useState<string[]>([]);

  const submitRename = () => {
    if (!renameCol || !renameLabel.trim()) return;
    runOp(
      "rename_column",
      { old_key: renameCol, new_key: makeStorageKey(renameLabel, 0), new_label: renameLabel.trim() },
      "Column renamed",
    );
    setRenameOpen(false);
    setRenameLabel("");
  };

  const submitDedupe = () => {
    runOp(
      "dedupe",
      { columns: dedupeColumns, label: "dedupe" },
      "Duplicates removed (undo available)",
    );
    setDedupeOpen(false);
    setDedupeColumns([]);
  };

  const toggleDedupeColumn = (key: string) => {
    setDedupeColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const busy = busyOp !== null;

  const exportHref = useMemo(
    () => `/api/datasets/${ds.id}/export?format=csv&view=${encodeURIComponent(sig)}`,
    [ds.id, sig],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-neutral-900">{ds.name}</h1>
            <StatusBadge status={ds.status} />
          </div>
          <p className="mt-0.5 text-sm text-neutral-500">
            {ds.original_filename}
            {ds.sheet_name ? ` · ${ds.sheet_name}` : ""} ·{" "}
            {ds.row_count.toLocaleString()} imported rows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={busy}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
            title="Undo last operation"
          >
            ↺ Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={busy}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
            title="Redo last undone operation"
          >
            ↻ Redo
          </button>
          <div className="flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-1 py-1">
            <span className="px-1 text-xs text-neutral-500">Export</span>
            <a
              href={exportHref}
              className="rounded px-2 py-1 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              CSV
            </a>
            <a
              href={`/api/datasets/${ds.id}/export?format=xlsx&view=${encodeURIComponent(sig)}`}
              className="rounded px-2 py-1 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              XLSX
            </a>
            <a
              href={`/api/datasets/${ds.id}/export?format=original`}
              className="rounded px-2 py-1 text-sm text-neutral-700 transition hover:bg-neutral-100"
              title="Download the untouched original file"
            >
              Original
            </a>
          </div>
        </div>
      </div>

      {/* Status messages */}
      {notice && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.kind === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </div>
      )}
      {ds.status === "error" && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Import failed: {ds.error_message}
        </div>
      )}
      {(ds.status === "pending" || ds.status === "processing") && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Import is {ds.status} — the table will appear when it finishes.
        </div>
      )}
      {ds.status === "pending" && (
        <p className="text-sm text-neutral-500">
          The import hasn&apos;t started yet. If it stays pending, try re-uploading.
        </p>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-neutral-200">
        {( [["data", "Data"], ["analyze", "Analyze"], ["activity", "Activity"]] as [Tab, string][]).map(
          ([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === value
                  ? "border-neutral-900 text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {tab === "data" && (
        <div className="space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3">
            <span className="text-sm font-medium text-neutral-700">View filter</span>
            <select
              value={filterDraft.key}
              onChange={(e) => setFilterDraft({ ...filterDraft, key: e.target.value })}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={filterDraft.op}
              onChange={(e) => setFilterDraft({ ...filterDraft, op: e.target.value as FilterOp })}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            >
              {FILTER_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {filterDraft.op !== "is_empty" && filterDraft.op !== "is_not_empty" && (
              <input
                value={filterDraft.value}
                onChange={(e) => setFilterDraft({ ...filterDraft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFilter();
                }}
                placeholder="Value…"
                className="w-40 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
            )}
            <button
              onClick={addFilter}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100"
            >
              + Add
            </button>
            {activeFilters && (
              <button
                onClick={() => setView((v) => ({ ...v, filters: [] }))}
                className="text-sm text-neutral-500 underline-offset-2 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {activeFilters && (
            <div className="flex flex-wrap items-center gap-2">
              {view.filters.map((f, i) => {
                const col = columns.find((c) => c.key === f.key);
                return (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-xs text-neutral-700"
                  >
                    {col?.label}: {f.op}
                    {f.op !== "is_empty" && f.op !== "is_not_empty" && (
                      <span className="font-medium">“{f.value}”</span>
                    )}
                    <button
                      onClick={() => removeFilter(i)}
                      className="text-neutral-400 hover:text-neutral-700"
                      aria-label="Remove filter"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Transform toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={deleteMatchingRows}
              disabled={!activeFilters || busy}
              className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-40"
              title={activeFilters ? "Permanently remove rows matching the current view filter" : "Add a view filter first"}
            >
              Delete matching rows
            </button>
            <button
              onClick={() => setRenameOpen(true)}
              disabled={busy}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
            >
              Rename column…
            </button>
            <button
              onClick={() => setDedupeOpen(true)}
              disabled={busy}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
            >
              Remove duplicates…
            </button>
          </div>

          {ds.status === "ready" && (
            <DataTable
              datasetId={ds.id}
              columns={ds.column_defs}
              view={view}
              onViewChange={setView}
              onCommitCell={handleCommitCell}
            />
          )}
        </div>
      )}

      {tab === "analyze" && ds.status === "ready" && (
        <AnalyzeTab datasetId={ds.id} columns={ds.column_defs} initialStats={initialStats} />
      )}

      {tab === "activity" && (
        <ActivityTab datasetId={ds.id} initialOps={initialOps} onUndo={handleUndo} onRedo={handleRedo} />
      )}

      {/* Rename dialog */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setRenameOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-semibold text-neutral-900">Rename column</h3>
            <label className="mb-1 block text-sm text-neutral-600">Column</label>
            <select
              value={renameCol}
              onChange={(e) => setRenameCol(e.target.value)}
              className="mb-3 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <label className="mb-1 block text-sm text-neutral-600">New name</label>
            <input
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
              }}
              className="mb-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              placeholder="New label"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameOpen(false)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                disabled={!renameLabel.trim()}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dedupe dialog */}
      {dedupeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setDedupeOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-semibold text-neutral-900">Remove duplicates</h3>
            <p className="mb-3 text-sm text-neutral-500">
              Pick columns to compare. With none selected, whole rows are compared
              (the first occurrence of each duplicate is kept).
            </p>
            <div className="mb-4 max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2">
              {columns.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-1 py-0.5 text-sm text-neutral-800">
                  <input
                    type="checkbox"
                    checked={dedupeColumns.includes(c.key)}
                    onChange={() => toggleDedupeColumn(c.key)}
                    className="rounded"
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDedupeOpen(false)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={submitDedupe}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Remove duplicates
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}