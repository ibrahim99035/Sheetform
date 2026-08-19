import { describe, expect, it } from "vitest";
import {
  inferRole,
  normalizeHeader,
  type ColumnSample,
} from "@/lib/analysis/roles";
import { resolveRoleKey } from "@/lib/analysis/modules";
import { assessServiceCoverage, SERVICE_IDS } from "@/lib/analysis/services";
import type { ColumnDef, ColumnRole } from "@/lib/types";

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

describe("normalizeHeader — arabic + latin", () => {
  it("keeps arabic letters, folds separators", () => {
    expect(normalizeHeader("كمية الجرد")).toBe("كميةالجرد");
    expect(normalizeHeader("تاريخ الشراء")).toBe("تاريخالشراء");
    expect(normalizeHeader("المُورد")).toBe("المورد");
  });
});

describe("inferRole — supplier / purchase headers", () => {
  it("matches supplier synonyms (en/fr/ar)", () => {
    expect(inferRole("Supplier", sample("string", ["Wholesale Co"]))?.role).toBe("supplier");
    expect(inferRole("Fournisseur", sample("string", ["X"]))?.role).toBe("supplier");
    expect(inferRole("المورد", sample("string", ["مورد 1"]))?.role).toBe("supplier");
    expect(inferRole("Distributor", sample("string", ["D-1"]))?.role).toBe("supplier");
  });

  it("matches purchase columns", () => {
    expect(inferRole("Purchase date", sample("date", ["2026-01-01"]))?.role).toBe("purchase_date");
    expect(inferRole("Date d'achat", sample("date", ["2026-01-01"]))?.role).toBe("purchase_date");
    expect(inferRole("Quantity purchased", sample("numeric", ["5"]))?.role).toBe("purchase_qty");
    expect(inferRole("Unit purchase cost", sample("numeric", ["1.25"]))?.role).toBe("purchase_cost");
    expect(inferRole("PO Number", sample("string", ["PO-1"]))?.role).toBe("purchase_order");
    expect(inferRole("رقم الطلب", sample("string", ["PO-1"]))?.role).toBe("purchase_order");
  });
});

describe("inferRole — geographic headers + coordinate shapes", () => {
  it("matches city / country / region headers", () => {
    expect(inferRole("City", sample("string", ["Cairo"]))?.role).toBe("city");
    expect(inferRole("Ville", sample("string", ["Paris"]))?.role).toBe("city");
    expect(inferRole("المحافظة", sample("string", ["القاهرة"]))?.role).toBe("region");
    expect(inferRole("Country", sample("string", ["Egypt"]))?.role).toBe("country");
    expect(inferRole("Region", sample("string", ["Delta"]))?.role).toBe("region");
  });

  it("matches coordinate headers (lat/lng)", () => {
    expect(inferRole("Latitude", sample("numeric", ["51.2333"]))?.role).toBe("latitude");
    expect(inferRole("الخط الطولي", sample("numeric", ["22.5667"]))?.role).toBe("longitude");
  });

  it("does NOT remap a 2dp price column to coordinates", () => {
    const r = inferRole("Prix", sample("numeric", ["12.50", "25.00", "7.25"]));
    expect(r?.role).toBe("unit_price");
  });
});

describe("inferRole — budget / stock-count / batch headers", () => {
  it("matches budget + target headers", () => {
    expect(inferRole("Budget", sample("numeric", ["100000"]))?.role).toBe("budget");
    expect(inferRole("Target", sample("numeric", ["100000"]))?.role).toBe("budget");
    expect(inferRole("الهدف", sample("numeric", ["100000"]))?.role).toBe("budget");
  });

  it("matches stock-count + batch headers", () => {
    expect(inferRole("Counted Qty", sample("numeric", ["10"]))?.role).toBe("counted_qty");
    expect(inferRole("كمية الجرد", sample("numeric", ["10"]))?.role).toBe("counted_qty");
    expect(inferRole("Batch", sample("string", ["B-2201"]))?.role).toBe("batch");
    expect(inferRole("Opening Stock", sample("numeric", ["45"]))?.role).toBe("opening_stock");
    expect(inferRole("Closing Stock", sample("numeric", ["12"]))?.role).toBe("closing_stock");
  });
});

describe("resolveRoleKey — fallbacks for new roles", () => {
  const defs: ColumnDef[] = [
    { key: "a", label: "Distributor", type: "string" },
    { key: "b", label: "Lat", type: "numeric" },
    { key: "c", label: "Lot No", type: "string" },
    { key: "d", label: "Budget", type: "numeric" },
  ];

  it("resolves via the KEY_FALLBACKS lexicon", () => {
    expect(resolveRoleKey(defs, "supplier", {})).toBe("a");
    expect(resolveRoleKey(defs, "latitude", {})).toBe("b");
    expect(resolveRoleKey(defs, "batch", {})).toBe("c");
    expect(resolveRoleKey(defs, "budget", {})).toBe("d");
  });
});

describe("assessServiceCoverage — nine services", () => {
  it("covers all nine service ids", () => {
    expect(assessServiceCoverage({})).toHaveLength(SERVICE_IDS.length);
  });

  it("flags every service as missing when no roles resolve", () => {
    const out = assessServiceCoverage({});
    expect(out.every((s) => !s.available)).toBe(true);
    // geography missing lists the geo roles
    const geo = out.find((s) => s.id === "geography");
    expect(geo?.missing.length).toBeGreaterThan(0);
  });

  it("sales-ready dataset reports sales + forecast + benchmarks as available", () => {
    const roleMap: Partial<Record<ColumnRole, string>> = {
      date: "date",
      product: "product",
      qty: "qty",
    };
    const out = assessServiceCoverage(roleMap);
    const byId = Object.fromEntries(out.map((s) => [s.id, s]));
    expect(byId.sales.available).toBe(true);
    expect(byId.forecasting.available).toBe(true);
    expect(byId.benchmarks.available).toBe(true);
    expect(byId.customers.available).toBe(false);
    expect(byId.suppliers.available).toBe(false);
  });

  it("purchase dataset enables supplier analysis", () => {
    const roleMap: Partial<Record<ColumnRole, string>> = { supplier: "supplier" };
    const out = assessServiceCoverage(roleMap);
    expect(out.find((s) => s.id === "suppliers")?.available).toBe(true);
  });

  it("geography is available when ANY geo column resolves", () => {
    const byCity = assessServiceCoverage({ city: "city" });
    expect(byCity.find((s) => s.id === "geography")?.available).toBe(true);
    const byCoords = assessServiceCoverage({ latitude: "lat", longitude: "lng" });
    expect(byCoords.find((s) => s.id === "geography")?.available).toBe(true);
  });

  it("stock-count dataset enables the stocktake service", () => {
    const roleMap: Partial<Record<ColumnRole, string>> = {
      product: "product",
      counted_qty: "counted",
    };
    const out = assessServiceCoverage(roleMap);
    expect(out.find((s) => s.id === "stocktake")?.available).toBe(true);
  });

  it("budget role enables the budgets service", () => {
    const out = assessServiceCoverage({ budget: "budget" });
    expect(out.find((s) => s.id === "budgets")?.available).toBe(true);
  });
});