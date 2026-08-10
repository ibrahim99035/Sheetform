import type { ColumnType } from "./types";

const TRUE_VALUES = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "f", "no", "n", "0"]);

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const text = toText(value);
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/^-?\d+$/.test(trimmed)) return null;
  const ts = Date.parse(trimmed);
  if (isNaN(ts)) return null;
  return new Date(ts);
}

export function coerceValue(
  type: ColumnType,
  raw: unknown,
): unknown {
  if (raw === null || raw === undefined) return null;

  switch (type) {
    case "string": {
      const text = toText(raw);
      return text === null ? null : text;
    }
    case "numeric": {
      const text = toText(raw);
      if (text === null) return null;
      const trimmed = text.trim();
      if (trimmed === "") return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    case "boolean": {
      const text = toText(raw);
      if (text === null) return null;
      const trimmed = text.trim().toLowerCase();
      if (TRUE_VALUES.has(trimmed)) return true;
      if (FALSE_VALUES.has(trimmed)) return false;
      return null;
    }
    case "date": {
      const date = parseDateValue(raw);
      return date ? date.toISOString() : null;
    }
    default:
      return null;
  }
}

export function inferType(values: unknown[]): ColumnType {
  const nonEmpty = values
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v).trim())
    .filter((s) => s !== "");

  if (nonEmpty.length === 0) return "string";

  const allBoolean =
    nonEmpty.length > 0 &&
    nonEmpty.every((s) => {
      const lower = s.toLowerCase();
      return lower === "true" || lower === "false";
    });
  if (allBoolean) return "boolean";

  const allNumeric = nonEmpty.every((s) => {
    const num = Number(s);
    return Number.isFinite(num);
  });
  if (allNumeric) return "numeric";

  const allDate = nonEmpty.every((s) => {
    if (/^-?\d+$/.test(s)) return false;
    return !isNaN(Date.parse(s));
  });
  if (allDate) return "date";

  return "string";
}

export function makeStorageKey(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `column_${index + 1}`;
}

export function makeUniqueKeys(labels: string[]): string[] {
  const used = new Map<string, number>();
  return labels.map((label, index) => {
    const base = makeStorageKey(label, index);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });
}
