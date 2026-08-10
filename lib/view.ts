import type { ViewState } from "./types";

export function viewSignature(view: ViewState): string {
  return JSON.stringify(view);
}

export function formatCellValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return "—";
  if (type === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function formatDateCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const d = new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}