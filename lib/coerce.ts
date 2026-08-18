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

/**
 * Hardened numeric parsing that mirrors the SQL `_sf_to_num` cast:
 * handles currency symbols, thousand separators, decimal commas and
 * exponents ("€12,50" -> 12.5, "1.234,56" -> 1234.56, "12 500.00" -> 12500,
 * "1,234,567.89" -> 1234567.89). Ambiguous lone separators follow the
 * currency convention (a trailing group of 3 = thousands).
 */
export function parseNumericValue(value: unknown): number | null {
  const text = toText(value);
  if (text === null) return null;

  let s = text.replace(/[^0-9+\-.,eE\s]/g, "").replace(/\s+/g, "").trim();
  if (s === "") return null;
  if (!/^[+-]?[0-9][0-9.,]*([eE][+-]?[0-9]+)?$/.test(s)) return null;

  const sign = /^[+-]/.test(s) ? s.slice(0, 1) : "";
  if (sign) s = s.slice(1);

  let exp = "";
  const expMatch = s.match(/[eE][+-]?[0-9]+/);
  if (expMatch) {
    exp = expMatch[0];
    s = s.slice(0, expMatch.index);
  }

  const normalized = normalizeNumericSeparators(s);
  if (normalized === null) return null;
  const num = Number(`${sign}${normalized}${exp}`);
  return Number.isFinite(num) ? num : null;
}

function normalizeNumericSeparators(s: string): string | null {
  if (s === "") return null;
  const commaCount = (s.match(/,/g) ?? []).length;
  const dotCount = (s.match(/\./g) ?? []).length;

  // both separators: the LAST one is the decimal separator
  if (commaCount > 0 && dotCount > 0) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
    return /^[0-9]+(\.[0-9]+)?$/.test(s) ? s : null;
  }

  // only commas
  if (commaCount > 0) {
    const lastComma = s.lastIndexOf(",");
    const trailing = s.length - lastComma - 1;
    if (trailing <= 2 && !/^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.slice(0, lastComma) + "." + s.slice(lastComma + 1);
    } else {
      s = s.replace(/,/g, "");
    }
    return /^[0-9]+(\.[0-9]+)?$/.test(s) ? s : null;
  }

  // only dots
  if (dotCount > 0) {
    if (dotCount === 1 && /^\d{1,3}\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, ""); // grouped thousands (currency-typical ambiguity)
    } else if (!/^\d{1,3}(\.\d{3})+$/.test(s)) {
      // keep a single clear decimal; reject ragged multi-dot forms
      return /^\d+\.\d+$/.test(s) ? s : null;
    } else {
      s = s.replace(/\./g, "");
    }
    return /^[0-9]+(\.[0-9]+)?$/.test(s) ? s : null;
  }

  return /^[0-9]+$/.test(s) ? s : null;
}

export function coerceValue(type: ColumnType, raw: unknown): unknown {
  const result = coerceValueDetailed(type, raw);
  return result === null ? null : result.value;
}

/**
 * Like `coerceValue` but preserves parse validity for invalid-count tracking.
 * `valid: false` means the raw value was present but could not be parsed as
 * the column type (as opposed to an empty/absent cell, which is `null`).
 */
export function coerceValueDetailed(
  type: ColumnType,
  raw: unknown,
): { value: unknown; valid: boolean } | null {
  if (raw === null || raw === undefined) return null;
  const blank =
    typeof raw === "string" || raw instanceof String
      ? raw.toString().trim() === ""
      : false;
  if (blank) return null;

  switch (type) {
    case "string": {
      const text = toText(raw);
      return text === null ? null : { value: text, valid: true };
    }
    case "numeric": {
      const num = parseNumericValue(raw);
      return num === null
        ? { value: null, valid: false }
        : { value: num, valid: true };
    }
    case "boolean": {
      const text = toText(raw);
      if (text === null) return null;
      const trimmed = text.trim().toLowerCase();
      if (TRUE_VALUES.has(trimmed)) return { value: true, valid: true };
      if (FALSE_VALUES.has(trimmed)) return { value: false, valid: true };
      return { value: null, valid: false };
    }
    case "date": {
      const date = parseDateValue(raw);
      return date
        ? { value: date.toISOString(), valid: true }
        : { value: null, valid: false };
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
    if (/[$€£¥₺]/.test(s) || /[.,]/.test(s.replace(/[+-]/g, ""))) {
      // currency symbols or digit-separators: use the hardened parser
      // (handles "1.234,56", "12,50", "1,234,567.89", "€12.99")
      const digits = s.replace(/[$€£¥₺\s]/g, "");
      if (/^[+-]?\d[\d.,]*$/.test(digits)) return parseNumericValue(s) !== null;
      return false;
    }
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
