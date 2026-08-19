import { describe, expect, it } from "vitest";
import {
  buildWhere,
  compileFormula,
  ident,
  lit,
  normalizeColumnType,
  sanitizeId,
} from "@/lib/datastore";
import { sanitizeId as opfsSanitizeId } from "@/lib/db/opfs";
import type { ColumnDef } from "@/lib/types";

const cols: ColumnDef[] = [
  { key: "branch", label: "Branch", type: "string" },
  { key: "amount", label: "Amount", type: "numeric" },
  { key: "date", label: "Date", type: "date" },
];

describe("duckdb datastore SQL builders", () => {
  it("sanitizeId keeps safe local table names", () => {
    expect(sanitizeId("abc-123_")).toBe("abc-123_");
    expect(sanitizeId("a b/c")).toBe("a_b_c");
  });

  it("ident quotes and escapes identifiers", () => {
    expect(ident("amount")).toBe('"amount"');
    expect(ident('we"ird')).toBe('"we""ird"');
  });

  it("lit renders literals safely", () => {
    expect(lit("Amoxil 500")).toBe("'Amoxil 500'");
    expect(lit("it's")).toBe("'it''s'");
    expect(lit(42.5)).toBe("42.5");
    expect(lit(null)).toBe("NULL");
    expect(lit(undefined)).toBe("NULL");
    expect(lit(true)).toBe("TRUE");
    expect(lit(Number.NaN)).toBe("NULL");
  });

  it("normalizeColumnType maps text → string", () => {
    expect(normalizeColumnType("text")).toBe("string");
    expect(normalizeColumnType("numeric")).toBe("numeric");
    expect(normalizeColumnType(undefined)).toBe("numeric");
  });

  it("buildWhere renders equals, ranges and emptiness", () => {
    const state = { cols, undo: [], redo: [] };
    expect(
      buildWhere(state, { sort: null, filters: [{ key: "amount", op: "gte", value: "10" }] }),
    ).toBe('CAST("amount" AS DOUBLE) >= CAST(\'10\' AS DOUBLE)');
    expect(
      buildWhere(state, { sort: null, filters: [{ key: "date", op: "lt", value: "2026-07-01" }] }),
    ).toBe('CAST("date" AS DATE) < CAST(\'2026-07-01\' AS DATE)');
    expect(
      buildWhere(state, { sort: null, filters: [{ key: "branch", op: "is_empty", value: "" }] }),
    ).toBe('"branch" IS NULL OR "branch" = \'\'');
    expect(buildWhere(state, { sort: null, filters: [] })).toBe("1=1");
    // filters referencing unknown columns are ignored (server-like leniency)
    expect(
      buildWhere(state, { sort: null, filters: [{ key: "nope", op: "equals", value: "1" }] }),
    ).toBe("1=1");
  });

  it("compileFormula only accepts known columns, operators and numbers", () => {
    const state = { cols, undo: [], redo: [] };
    expect(compileFormula(state, "amount * 2 - 1")).toBe('"amount" * 2 - 1');
    expect(compileFormula(state, "branch")).toBe('"branch"');
    expect(compileFormula(state, "(amount)").length).toBeGreaterThan(0);
    expect(compileFormula(state, "amount / (1 + 1)")).toBe('"amount" / ( 1 + 1 )');
  });

  it("compileFormula rejects unknown columns and unsafe input", () => {
    const state = { cols, undo: [], redo: [] };
    expect(() => compileFormula(state, "amount * mystery")).toThrow("Unknown column");
    expect(() => compileFormula(state, "amount; DROP TABLE x")).toThrow("Unknown column");
    expect(() => compileFormula(state, "upper(amount)")).toThrow("Unknown column");
    expect(() => compileFormula(state, "'literal' + amount")).toThrow("Unknown column");
  });

  it("opfs sanitizeId mirrors the datastore one", () => {
    expect(opfsSanitizeId("a b/c")).toBe(sanitizeId("a b/c"));
  });
});