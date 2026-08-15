"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CopyX,
  Download,
  History,
  Loader2,
  PencilLine,
  Plus,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Table2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useSupabase } from "@/lib/supabase/provider";
import { DataTable } from "@/components/data-table";
import { AnalyzeTab } from "@/components/analyze-tab";
import { ActivityTab } from "@/components/activity-tab";
import { StatusBadge } from "@/components/status-badge";
import { applyOperation, redoOperation, undoOperation } from "@/lib/dataset-api";
import { retryImport } from "@/lib/actions/datasets";
import { makeStorageKey, coerceValue } from "@/lib/coerce";
import { viewSignature } from "@/lib/view";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  const { toast } = useToast();

  const [ds, setDs] = useState<Dataset>(dataset);
  const [tab, setTab] = useState<Tab>("data");
  const [view, setView] = useState<ViewState>({ sort: null, filters: [] });
  const [busyOp, setBusyOp] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

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
            toast({ text: "Import finished." });
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
  }, [supabase, ds.id, invalidateDataset, router, toast]);

  const handleUndo = useCallback(async () => {
    setBusyOp("undo");
    const res = await undoOperation(supabase, ds.id);
    setBusyOp(null);
    if (!res.ok) {
      toast({ kind: "error", text: res.error ?? "Nothing to undo" });
      return;
    }
    invalidateDataset();
    toast({ text: "Undid last operation" });
  }, [supabase, ds.id, invalidateDataset, toast]);

  const handleRedo = useCallback(async () => {
    setBusyOp("redo");
    const res = await redoOperation(supabase, ds.id);
    setBusyOp(null);
    if (!res.ok) {
      toast({ kind: "error", text: res.error ?? "Nothing to redo" });
      return;
    }
    invalidateDataset();
    toast({ text: "Redid operation" });
  }, [supabase, ds.id, invalidateDataset, toast]);

  const handleUndoRef = useRef(handleUndo);
  useEffect(() => {
    handleUndoRef.current = handleUndo;
  }, [handleUndo]);

  const handleRetryImport = useCallback(async () => {
    setRetrying(true);
    const res = await retryImport(ds.id);
    setRetrying(false);
    if (!res.ok) {
      toast({ kind: "error", text: res.error ?? "Could not retry the import." });
      return;
    }
    setDs((prev) => ({
      ...prev,
      status: "pending",
      error_message: null,
      updated_at: new Date().toISOString(),
    }));
    toast({ text: "Import restarted — the table will update when it finishes." });
  }, [ds.id, toast]);

  const runOp = useCallback(
    async (operation: string, params: Record<string, unknown>, okMessage?: string) => {
      setBusyOp(operation);
      try {
        const res = await applyOperation(supabase, ds.id, operation, params);
        if (!res.ok) {
          toast({ kind: "error", text: res.error ?? "Operation failed" });
          return;
        }
        invalidateDataset();
        toast({
          text: okMessage ?? res.message ?? "Done",
          action: { label: "Undo", onClick: () => handleUndoRef.current() },
        });
      } catch (e) {
        toast({ kind: "error", text: e instanceof Error ? e.message : "Operation failed" });
      } finally {
        setBusyOp(null);
      }
    },
    [supabase, ds.id, invalidateDataset, toast],
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
      if (
        col?.type === "numeric" &&
        !/^-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?$/.test(filterDraft.value)
      ) {
        toast({ kind: "error", text: "Enter a valid number for this filter." });
        return;
      }
      if (col?.type === "date" && isNaN(Date.parse(filterDraft.value))) {
        toast({ kind: "error", text: "Enter a valid date for this filter." });
        return;
      }
    }
    const spec: FilterSpec = { ...filterDraft };
    if (spec.op === "is_empty" || spec.op === "is_not_empty") spec.value = "";
    setView((v) => ({ ...v, filters: [...v.filters, spec] }));
    setFilterDraft({ ...filterDraft, value: "" });
  };

  const removeFilter = (index: number) => {
    setView((v) => ({ ...v, filters: v.filters.filter((_, i) => i !== index) }));
  };

  const deleteMatchingRows = () => {
    if (!activeFilters) return;
    runOp(
      "filter_rows",
      { filters: view.filters, label: `${view.filters.length} filter(s)` },
      "Rows removed",
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
      "Duplicates removed",
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

  const importing = ds.status === "pending" || ds.status === "processing";

  return (
    <div className="animate-slide-up space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {ds.name}
            </h1>
            <StatusBadge status={ds.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {ds.original_filename}
            {ds.sheet_name ? ` · ${ds.sheet_name}` : ""} ·{" "}
            {ds.row_count.toLocaleString()} imported rows
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleUndo}
            disabled={busy}
            size="sm"
            title="Undo last operation"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Undo
          </Button>
          <Button
            onClick={handleRedo}
            disabled={busy}
            size="sm"
            title="Redo last undone operation"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Redo
          </Button>
          <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            <span className="flex items-center gap-1 px-1.5 pl-2 text-xs font-medium text-faint">
              <Download className="h-3.5 w-3.5" />
              Export
            </span>
            {[
              { label: "CSV", href: exportHref },
              { label: "XLSX", href: `/api/datasets/${ds.id}/export?format=xlsx&view=${encodeURIComponent(sig)}` },
              {
                label: "Original",
                href: `/api/datasets/${ds.id}/export?format=original`,
                title: "Download the untouched original file",
              },
            ].map((opt) => (
              <a
                key={opt.label}
                href={opt.href}
                title={opt.title}
                className="rounded-md px-2 py-1 text-[13px] font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground"
              >
                {opt.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Status banners */}
      {ds.status === "error" && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-danger/25 bg-danger-subtle px-4 py-3 text-sm text-danger-text">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Import failed</p>
              <p className="mt-0.5">{ds.error_message}</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleRetryImport}
            disabled={retrying}
            title="Restart the import pipeline for this file"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
            Retry import
          </Button>
        </div>
      )}
      {importing && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-warning/25 bg-warning-subtle px-4 py-3 text-sm text-warning-text">
          <div className="flex items-start gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <div>
              <p className="font-medium">
                Import is {ds.status} — the table will appear when it finishes.
              </p>
              {ds.status === "pending" && (
                <p className="mt-0.5 text-warning-text/80">
                  The import hasn’t started yet. If it stays pending, retry it.
                </p>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRetryImport}
            disabled={retrying}
            title="Restart the import pipeline for this file"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "data", label: "Data", icon: <Table2 className="h-3.5 w-3.5" /> },
          { value: "analyze", label: "Analyze", icon: <BarChart3 className="h-3.5 w-3.5" /> },
          { value: "activity", label: "Activity", icon: <History className="h-3.5 w-3.5" /> },
        ]}
      />

      {tab === "data" && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm shadow-black/[0.02]">
            <span className="mr-1 text-sm font-medium text-muted">View filter</span>
            <Select
              value={filterDraft.key}
              onChange={(e) => setFilterDraft({ ...filterDraft, key: e.target.value })}
              className="w-full sm:w-40"
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Select
              value={filterDraft.op}
              onChange={(e) => setFilterDraft({ ...filterDraft, op: e.target.value as FilterOp })}
              className="w-full sm:w-40"
            >
              {FILTER_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {filterDraft.op !== "is_empty" && filterDraft.op !== "is_not_empty" && (
              <Input
                value={filterDraft.value}
                onChange={(e) => setFilterDraft({ ...filterDraft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addFilter();
                }}
                placeholder="Value…"
                className="w-full sm:w-40"
              />
            )}
            <Button onClick={addFilter} size="sm" className="flex-1 sm:flex-none">
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
            {activeFilters && (
              <button
                onClick={() => setView((v) => ({ ...v, filters: [] }))}
                className="px-1 text-sm text-muted underline-offset-2 transition hover:text-foreground hover:underline"
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
                    className="inline-flex animate-fade-in items-center gap-1.5 rounded-full border border-brand/25 bg-brand-subtle px-3 py-1 text-xs font-medium text-brand"
                  >
                    {col?.label}: {f.op}
                    {f.op !== "is_empty" && f.op !== "is_not_empty" && (
                      <span className="font-semibold">“{f.value}”</span>
                    )}
                    <button
                      onClick={() => removeFilter(i)}
                      className="-mr-1 rounded-full p-0.5 text-brand/70 transition hover:text-brand"
                      aria-label="Remove filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Transform toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={deleteMatchingRows}
              disabled={!activeFilters || busy}
              variant="danger"
              size="sm"
              title={
                activeFilters
                  ? "Permanently remove rows matching the current view filter"
                  : "Add a view filter first"
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete matching rows
            </Button>
            <Button onClick={() => setRenameOpen(true)} disabled={busy} size="sm">
              <PencilLine className="h-3.5 w-3.5" />
              Rename column…
            </Button>
            <Button onClick={() => setDedupeOpen(true)} disabled={busy} size="sm">
              <CopyX className="h-3.5 w-3.5" />
              Remove duplicates…
            </Button>
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
        <ActivityTab
          datasetId={ds.id}
          initialOps={initialOps}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      )}

      {/* Rename dialog */}
      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename column"
        description="Pick a column and give it a new name."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rename-col">Column</Label>
            <Select
              id="rename-col"
              value={renameCol}
              onChange={(e) => setRenameCol(e.target.value)}
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-label">New name</Label>
            <Input
              id="rename-label"
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
              }}
              placeholder="New label"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={() => setRenameOpen(false)} size="sm">
              Cancel
            </Button>
            <Button
              onClick={submitRename}
              disabled={!renameLabel.trim()}
              variant="primary"
              size="sm"
            >
              Rename
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Dedupe dialog */}
      <Dialog
        open={dedupeOpen}
        onClose={() => setDedupeOpen(false)}
        title="Remove duplicates"
        description="Pick columns to compare. With none selected, whole rows are compared (the first occurrence of each duplicate is kept)."
      >
        <div className="space-y-4">
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">
            {columns.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground transition hover:bg-surface-subtle"
              >
                <Checkbox
                  checked={dedupeColumns.includes(c.key)}
                  onChange={() => toggleDedupeColumn(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDedupeOpen(false)} size="sm">
              Cancel
            </Button>
            <Button onClick={submitDedupe} variant="primary" size="sm">
              Remove duplicates
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
