"use client";

import type { InferredColumn, ColumnType } from "@/lib/types";

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "numeric", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
];

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
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead>
            <tr className="bg-neutral-50">
              <th className="w-12 border-r border-neutral-200 px-3 py-2 text-left font-medium text-neutral-400">
                #
              </th>
              {headers.map((header, i) => (
                <th key={i} className="min-w-[180px] border-r border-neutral-200 px-3 py-2 text-left align-top">
                  <input
                    value={columns[i]?.label ?? header}
                    onChange={(e) => updateColumn(i, { label: e.target.value })}
                    className="mb-1 w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-neutral-900 outline-none hover:border-neutral-300 focus:border-neutral-400"
                  />
                  <select
                    value={columns[i]?.type ?? "string"}
                    onChange={(e) => updateColumn(i, { type: e.target.value as ColumnType })}
                    className="w-full rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs text-neutral-600 outline-none focus:border-neutral-500"
                  >
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="mt-0.5 px-1 font-mono text-[10px] text-neutral-400">
                    {columns[i]?.key}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sampleRows.map((row, r) => (
              <tr key={r} className="hover:bg-neutral-50">
                <td className="border-r border-neutral-200 px-3 py-1.5 text-neutral-400">
                  {r + 1}
                </td>
                {headers.map((_, i) => (
                  <td key={i} className="border-r border-neutral-200 px-3 py-1.5 text-neutral-800">
                    {row[i] === "" ? <span className="text-neutral-300">— empty —</span> : (row[i] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rowHint && (
        <p className="border-t border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          {rowHint}
        </p>
      )}
    </div>
  );
}