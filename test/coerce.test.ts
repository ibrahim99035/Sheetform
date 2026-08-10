import { describe, expect, it } from "vitest";
import {
  coerceValue,
  inferType,
  makeStorageKey,
  makeUniqueKeys,
  parseDateValue,
} from "@/lib/coerce";

describe("coerceValue", () => {
  it("coerces numeric values and nulls non-numeric", () => {
    expect(coerceValue("numeric", "42")).toBe(42);
    expect(coerceValue("numeric", " 42.5 ")).toBe(42.5);
    expect(coerceValue("numeric", "-1e3")).toBe(-1000);
    expect(coerceValue("numeric", "N/A")).toBeNull();
    expect(coerceValue("numeric", "")).toBeNull();
    expect(coerceValue("numeric", null)).toBeNull();
  });

  it("coerces booleans", () => {
    expect(coerceValue("boolean", "true")).toBe(true);
    expect(coerceValue("boolean", "FALSE")).toBe(false);
    expect(coerceValue("boolean", "yes")).toBe(true);
    expect(coerceValue("boolean", "no")).toBe(false);
    expect(coerceValue("boolean", "maybe")).toBeNull();
  });

  it("coerces dates to ISO strings", () => {
    const iso = coerceValue("date", "2024-01-15");
    expect(iso).toBe("2024-01-15T00:00:00.000Z");
    expect(coerceValue("date", "2024-01-15")).not.toBeNull();
    expect(coerceValue("date", "not-a-date")).toBeNull();
    expect(coerceValue("date", "1234")).toBeNull();
    expect(coerceValue("date", new Date("2024-05-01"))).toBe("2024-05-01T00:00:00.000Z");
  });

  it("keeps strings as-is", () => {
    expect(coerceValue("string", "hello")).toBe("hello");
    expect(coerceValue("string", "42")).toBe("42");
    expect(coerceValue("string", null)).toBeNull();
  });
});

describe("parseDateValue", () => {
  it("accepts ISO and common formats, rejects plain numbers", () => {
    expect(parseDateValue("2024-03-01")).not.toBeNull();
    expect(parseDateValue("03/01/2024")).not.toBeNull();
    expect(parseDateValue("2024")).toBeNull();
    expect(parseDateValue("hello")).toBeNull();
    expect(parseDateValue(new Date())).not.toBeNull();
  });
});

describe("inferType", () => {
  it("infers numeric", () => {
    expect(inferType(["1", "2", "3"])).toBe("numeric");
    expect(inferType(["1", "1.5", "abc"])).toBe("string");
  });
  it("infers boolean only for true/false", () => {
    expect(inferType(["true", "false", "true"])).toBe("boolean");
    expect(inferType(["1", "0"])).toBe("numeric");
  });
  it("infers date", () => {
    expect(inferType(["2024-01-01", "2024-01-02"])).toBe("date");
    expect(inferType(["2024-01-01", "nope"])).toBe("string");
  });
  it("defaults empty to string", () => {
    expect(inferType([null, "", undefined])).toBe("string");
  });
});

describe("makeStorageKey / makeUniqueKeys", () => {
  it("sanitizes labels", () => {
    expect(makeStorageKey("Amount (USD)", 0)).toBe("amount_usd");
    expect(makeStorageKey("  ", 2)).toBe("column_3");
    expect(makeStorageKey("✓", 0)).toBe("column_1");
  });
  it("deduplicates keys", () => {
    expect(makeUniqueKeys(["Name", "Name", "Amount"])).toEqual([
      "name",
      "name_1",
      "amount",
    ]);
  });
});