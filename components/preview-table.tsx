"use client";

import type { InferredColumn, ColumnType } from "@/lib/types";
import { cn } from "@/lib/cn";

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "numeric", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
];

const TYPE_DOT: Record<ColumnType, string> = {
  string: "bg-info",
  numeric: "bg-brand",
  date: "bg-warning",
  boolean: "bg-success",
};

interface PreviewTableProps {
  headers: string[];
  sampleRows: string[][];
  columns: InferredColumn[];
  onColumnsChange: (cols: InferredColumn[]) => void;
  rowHint?: string;
}

export function PreviewTable({
  headers,
  sampleRows,
  columns,
  onColumnsChange,
  rowHint,
}: PreviewTableProps) {
  const updateColumn = (index: number, patch: Partial<InferredColumn>) => {
    const next = columns.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onColumnsChange(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.02]">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead>
            <tr className="bg-surface-subtle">
              <th className="w-12 border-r border-border px-3 py-2 text-left font-medium text-faint">
                #
              </th>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="min-w-[180px] border-r border-border px-3 py-2 text-left align-top"
                >
                  <input
                    value={columns[i]?.label ?? header}
                    onChange={(e) => updateColumn(i, { label: e.target.value })}
                    className="mb-1.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-foreground outline-none transition hover:border-border focus:border-brand"
                  />
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TYPE_DOT[columns[i]?.type ?? "string"])}
                    />
                    <select
                      value={columns[i]?.type ?? "string"}
                      onChange={(e) => updateColumn(i, { type: e.target.value as ColumnType })}
                      className="w-full rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-muted outline-none transition focus:border-brand"
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1 px-1 font-mono text-[10px] text-faint">
                    {columns[i]?.key}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sampleRows.map((row, r) => (
              <tr key={r} className="transition-colors hover:bg-surface-subtle/50">
                <td className="border-r border-border px-3 py-1.5 font-mono text-xs text-faint">
                  {r + 1}
                </td>
                {headers.map((_, i) => (
                  <td key={i} className="border-r border-border px-3 py-1.5 text-foreground">
                    {row[i] === "" ? (
                      <span className="text-faint">— empty —</span>
                    ) : (
                      (row[i] ?? "—")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rowHint && (
        <p className="border-t border-border bg-surface-subtle px-3 py-2 text-xs text-muted">
          {rowHint}
        </p>
      )}
    </div>
  );
}
