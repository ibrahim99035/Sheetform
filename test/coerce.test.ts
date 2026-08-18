import { describe, expect, it } from "vitest";
import {
  coerceValue,
  coerceValueDetailed,
  inferType,
  makeStorageKey,
  makeUniqueKeys,
  parseDateValue,
  parseNumericValue,
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

describe("parseNumericValue", () => {
  it("parses plain numbers and exponents", () => {
    expect(parseNumericValue("42")).toBe(42);
    expect(parseNumericValue("42.5")).toBe(42.5);
    expect(parseNumericValue("-1e3")).toBe(-1000);
    expect(parseNumericValue(" 12.5 ")).toBe(12.5);
  });

  it("parses currency symbols", () => {
    expect(parseNumericValue("€12,50")).toBe(12.5);
    expect(parseNumericValue("$1,234.56")).toBe(1234.56);
    expect(parseNumericValue("£9.99")).toBe(9.99);
  });

  it("parses thousands separators and decimal commas", () => {
    expect(parseNumericValue("1.234,56")).toBe(1234.56);
    expect(parseNumericValue("1,234,567.89")).toBe(1234567.89);
    expect(parseNumericValue("12 500.00")).toBe(12500);
    expect(parseNumericValue("1.234")).toBe(1234);
    expect(parseNumericValue("1234.56")).toBe(1234.56);
  });

  it("rejects garbage", () => {
    expect(parseNumericValue("abc")).toBeNull();
    expect(parseNumericValue("")).toBeNull();
    expect(parseNumericValue("1.2.3")).toBeNull();
    expect(parseNumericValue("N/A")).toBeNull();
    expect(parseNumericValue(null)).toBeNull();
  });
});

describe("coerceValueDetailed", () => {
  it("flags unparseable values as invalid", () => {
    expect(coerceValueDetailed("numeric", "abc")).toEqual({ value: null, valid: false });
    expect(coerceValueDetailed("numeric", "12,50")).toEqual({ value: 12.5, valid: true });
  });

  it("treats blank cells as absent (null), not invalid", () => {
    expect(coerceValueDetailed("numeric", "  ")).toBeNull();
    expect(coerceValueDetailed("date", "")).toBeNull();
    expect(coerceValueDetailed("numeric", null)).toBeNull();
  });

  it("coerces currency-formatted numerics", () => {
    expect(coerceValue("numeric", "€12,50")).toBe(12.5);
    expect(coerceValue("numeric", "1.234,56")).toBe(1234.56);
  });
});

describe("inferType with localized numerics", () => {
  it("types currency and decimal-comma columns as numeric", () => {
    expect(inferType(["1.234,56", "2.345,67", "3.456,78"])).toBe("numeric");
    expect(inferType(["€12,50", "€9,99", "€3,25"])).toBe("numeric");
    expect(inferType(["$1,234.56", "$78.00"])).toBe("numeric");
  });

  it("keeps date-like strings as date, not numeric", () => {
    expect(inferType(["2024-01-15", "2024-02-20"])).toBe("date");
    expect(inferType(["01/03/2024", "02/04/2024"])).toBe("date");
  });
});