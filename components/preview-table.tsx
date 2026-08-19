"use client";

import type { InferredColumn, ColumnType, ColumnRole } from "@/lib/types";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/analysis/roles";

const TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "numeric", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
];

const ROLE_OPTIONS: { value: ColumnRole | ""; label: string }[] = [
  { value: "", label: "No role" },
  { value: "date", label: "Date" },
  { value: "branch", label: "Branch" },
  { value: "transaction_id", label: "Transaction" },
  { value: "product", label: "Product" },
  { value: "category", label: "Category" },
  { value: "qty", label: "Quantity" },
  { value: "unit_price", label: "Unit price" },
  { value: "cost", label: "Unit cost" },
  { value: "refund", label: "Refund" },
  { value: "sku", label: "SKU" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
  { value: "tax", label: "Tax" },
  { value: "account", label: "Account" },
  { value: "patient", label: "Patient" },
  { value: "supplier", label: "Supplier" },
  { value: "purchase_date", label: "Purchase date" },
  { value: "purchase_qty", label: "Purchase qty" },
  { value: "purchase_cost", label: "Purchase cost" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "city", label: "City" },
  { value: "country", label: "Country" },
  { value: "region", label: "Region" },
  { value: "latitude", label: "Latitude" },
  { value: "longitude", label: "Longitude" },
  { value: "budget", label: "Budget / target" },
  { value: "opening_stock", label: "Opening stock" },
  { value: "closing_stock", label: "Closing stock" },
  { value: "batch", label: "Batch / lot" },
  { value: "counted_qty", label: "Counted qty" },
  { value: "sales_rep", label: "Sales rep" },
  { value: "sales_team", label: "Sales team" },
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
                      className="w-full rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-foreground outline-none transition focus:border-brand"
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                      Role
                    </span>
                    <select
                      value={columns[i]?.role ?? ""}
                      onChange={(e) =>
                        updateColumn(i, {
                          role: (e.target.value || undefined) as ColumnRole | undefined,
                          role_confidence: e.target.value ? "high" : undefined,
                        })
                      }
                      className="w-full rounded border border-brand/25 bg-brand-subtle px-1.5 py-0.5 text-xs text-brand outline-none transition focus:border-brand"
                      title={columns[i]?.role ? `Inferred or assigned role (auto: ${roleLabel(columns[i].role!)}${columns[i].role_confidence ? `, ${columns[i].role_confidence}` : ""})` : "Assign a role to this column"}
                    >
                      {ROLE_OPTIONS.map((o) => (
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
