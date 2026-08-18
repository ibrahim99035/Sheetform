import { describe, expect, it } from "vitest";
import {
  inferRole,
  inferRoles,
  normalizeHeader,
  withRoleConfidence,
  type ColumnSample,
} from "@/lib/analysis/roles";
import type { ColumnDef } from "@/lib/types";

function sample(
  type: ColumnSample["type"],
  values: (string | null)[],
  opts: Partial<ColumnSample> = {},
): ColumnSample {
  const nonNull = values.filter((v): v is string => Boolean(v));
  return {
    type,
    values,
    distinct: new Set(nonNull).size || 1,
    nonNullCount: nonNull.length,
    totalRows: values.length,
    colIndex: 0,
    ...opts,
  };
}

describe("normalizeHeader", () => {
  it("folds case, diacritics and separators", () => {
    expect(normalizeHeader("Transaction ID")).toBe("transactionid");
    expect(normalizeHeader("Prix Unitaire")).toBe("prixunitaire");
    expect(normalizeHeader("Chiffre d'affaires")).toBe("chiffredaffaires");
  });
});

describe("inferRole — header matches", () => {
  it("maps exact english headers", () => {
    expect(inferRole("Date", sample("date", ["2024-01-01"]))?.role).toBe("date");
    expect(inferRole("Quantity", sample("numeric", ["1", "2"]))?.role).toBe("qty");
    expect(inferRole("Unit price", sample("numeric", ["1.5", "2.25"]))?.role).toBe("unit_price");
    expect(inferRole("Product", sample("string", ["Paracetamol"]))?.role).toBe("product");
    expect(inferRole("Category", sample("string", ["Analgesic"]))?.role).toBe("category");
    expect(inferRole("Branch", sample("string", ["Store A"]))?.role).toBe("branch");
    expect(inferRole("Transaction ID", sample("string", ["TX-1"]))?.role).toBe("transaction_id");
    expect(inferRole("Revenue", sample("numeric", ["100", "50"]))?.role).toBe("revenue");
  });

  it("matches french and german synonyms", () => {
    expect(inferRole("Quantité", sample("numeric", ["1", "2"]))?.role).toBe("qty");
    expect(inferRole("Date", sample("date", ["01/03/2024", "02/03/2024"]))?.role).toBe("date");
    expect(inferRole("Montant", sample("numeric", ["1.5", "2"]) )?.role).toBe("revenue");
    expect(inferRole("Menge", sample("numeric", ["1", "2"]))?.role).toBe("qty");
  });
});

describe("inferRole — value-shape heuristics", () => {
  it("detects EAN-13 columns", () => {
    const r = inferRole("Code", sample("string", [
      "3400930217414", "3400930217421", "6111102023395",
    ]));
    expect(r?.role).toBe("sku");
  });

  it("detects prices from decimal monetary values", () => {
    const r = inferRole("Serum", sample("string", ["1.99", "2.50", "3.25"]));
    expect(r?.role).toBe("unit_price");
  });

  it("detects aggregate revenue amounts", () => {
    const r = inferRole("Amount", sample("numeric", ["1500", "3200", "25.00"]));
    expect(r?.role).toBe("revenue");
  });

  it("detects high-cardinality identifiers", () => {
    const r = inferRole("ID", sample("string", [
      "2024-0001", "2024-0002", "2024-0003", "2024-0004",
    ], { distinct: 4, nonNullCount: 4 }));
    expect(r?.role).toBe("transaction_id");
  });

  it("detects quantity from small positive integers", () => {
    const r = inferRole("n", sample("numeric", ["1", "2", "3", "4"]));
    expect(r?.role).toBe("qty");
  });

  it("returns null when nothing matches", () => {
    expect(inferRole("Notes", sample("string", ["a", "b cd", "ef gh i"], {
      distinct: 3,
    }))).toBeNull();
  });
});

describe("inferRoles — collision resolution", () => {
  it("keeps the higher-confidence assignment on duplicate roles", () => {
    const defs: ColumnDef[] = [
      { key: "qty_1", label: "Quantity", type: "numeric" },
      { key: "unknown", label: "Count", type: "numeric" },
    ];
    const samples = {
      qty_1: sample("numeric", ["1", "2", "3"]),
      unknown: sample("numeric", ["4", "5", "6"]),
    };
    const out = inferRoles(defs, samples);
    // both slot into qty; "Quantity" header beats the data-driven guess
    expect(out.find((r) => r.role === "qty")?.key).toBe("qty_1");
  });
});

describe("withRoleConfidence", () => {
  it("stamps role and confidence onto defs", () => {
    const defs: ColumnDef[] = [{ key: "qty", label: "Quantity", type: "numeric" }];
    const out = withRoleConfidence(defs, [
      { key: "qty", label: "Quantity", role: "qty", confidence: "high", reason: "header" },
    ]);
    expect(out[0]).toMatchObject({ role: "qty", role_confidence: "high" });
  });

  it("leaves unmatched columns untouched", () => {
    const defs: ColumnDef[] = [{ key: "notes", label: "Notes", type: "string" }];
    const out = withRoleConfidence(defs, []);
    expect(out[0]).toEqual(defs[0]);
  });
});