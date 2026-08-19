import type { ColumnDef, ColumnRole, DatasetKind } from "@/lib/types";
import { runRfm } from "./rfm";
import { runBasket } from "./basket";
import { runAbcXyz, demandSeriesByProduct, type DemandRow, type ProductRevenue } from "./abc-xyz";
import { runSafetyStock } from "./safety-stock";
import { runExpiry, type DemandForProduct, type InventoryLine } from "./expiry";
import { runForecast, type ForecastPoint } from "./forecast";
import { dailyRollups, categoryRollups } from "./benchmark";
import { runSalesLens } from "./sales";
import { runSupplierLens, type PurchaseLine } from "./supplier";
import { runGeography, type GeoLine } from "./geography";
import { runBudget, type BudgetLine } from "./budget";
import { runStocktake, type StocktakeLine, type SystemStockLine } from "./stocktake";

/**
 * Deterministic pharmacy analytics orchestrator.
 *
 * Given a dataset's column definitions (with roles) and its rows, computes all
 * five enterprise modules in one pass. Pure and side-effect free — it runs
 * server-side today (lib/actions/pharmacy.ts) and against the local DuckDB
 * table in the local-engine path (lib/analysis/sql.ts provides the same
 * projections as optimized SQL; this orchestrator is the source of truth).
 */

export type ModuleState<T> =
  | { available: true; result: T }
  | { available: false; reason: string };

export interface RfmModuleResult {
  segmentation: ReturnType<typeof runRfm>;
}

export interface BasketModuleResult {
  marketBasket: ReturnType<typeof runBasket>;
}

export interface InventoryModuleResult {
  abcXyz: ReturnType<typeof runAbcXyz>;
  safetyStock: ReturnType<typeof runSafetyStock>;
  expiry: ReturnType<typeof runExpiry> | null;
}

export interface ForecastModuleResult {
  forecast: ReturnType<typeof runForecast>;
}

export interface BenchmarkModuleResult {
  daily: ReturnType<typeof dailyRollups>;
  categories: ReturnType<typeof categoryRollups>;
  patient_count: number;
  hashed_patients: boolean;
}

export interface SalesLensModuleResult {
  sales: ReturnType<typeof runSalesLens>;
}

export interface SupplierModuleResult {
  suppliers: ReturnType<typeof runSupplierLens>;
}

export interface GeographyModuleResult {
  geography: ReturnType<typeof runGeography>;
}

export interface BudgetModuleResult {
  budget: ReturnType<typeof runBudget>;
}

export interface StocktakeModuleResult {
  stocktake: ReturnType<typeof runStocktake>;
}

export interface PharmacySuite {
  generatedAt: string;
  kind: DatasetKind | null;
  rows: number;
  columns: { key: string; label: string; type: string }[];
  roleMap: Partial<Record<ColumnRole, string>>;
  modules: {
    sales: ModuleState<SalesLensModuleResult>;
    supplier: ModuleState<SupplierModuleResult>;
    geography: ModuleState<GeographyModuleResult>;
    budget: ModuleState<BudgetModuleResult>;
    stocktake: ModuleState<StocktakeModuleResult>;
    rfm: ModuleState<RfmModuleResult>;
    basket: ModuleState<BasketModuleResult>;
    abcXyz: ModuleState<ReturnType<typeof runAbcXyz>>;
    safetyStock: ModuleState<ReturnType<typeof runSafetyStock>>;
    expiry: ModuleState<ReturnType<typeof runExpiry>>;
    forecast: ModuleState<ForecastModuleResult>;
    benchmark: ModuleState<BenchmarkModuleResult>;
  };
}

export interface SuiteRunOptions {
  kind?: DatasetKind | null;
  roles?: Partial<Record<ColumnRole, string>>;
  /** forecast metric target: "units" (qty) or "revenue". */
  forecastMetric?: "units" | "revenue";
  forecastHorizon?: number;
  benchmarkRegion?: string | null;
}

export interface ProjectedRows {
  sales: {
    customer_id: string | null;
    date: string | number;
    transaction_id: string | null;
    product: string;
    category: string | null;
    amount: number;
    units: number;
    branch: string | null;
    refunded: boolean;
    rep: string | null;
    team: string | null;
    raw: Record<string, unknown>;
  }[];
  inventory: InventoryLine[];
  purchases: PurchaseLine[];
  geo: GeoLine[];
  budgets: BudgetLine[];
  stocktake: {
    counts: StocktakeLine[];
    system: SystemStockLine[];
  };
}

// Column-key fallbacks used when a role is not stamped on the defs (older
// datasets without role resolution).
const KEY_FALLBACKS: Record<ColumnRole, string[]> = {
  date: ["date", "datevente", "salesdate", "jour"],
  branch: ["branch", "store", "pharmacy", "site"],
  transaction_id: ["transaction_id", "transactionid", "txn", "invoice", "receipt", "bonno"],
  product: ["product", "item", "drug", "designation", "libelle"],
  category: ["category", "cat", "class", "rayon", "type", "familie"],
  qty: ["qty", "quantity", "qt", "units", "pieces", "noofunits", "kammia"],
  unit_price: ["unit_price", "unitprice", "price", "prix", "pu"],
  cost: ["cost", "unitcost", "cogs", "prixachat"],
  refund: ["refund", "remboursement", "retour", "avoir"],
  sku: ["sku", "ean", "barcode", "codebarre"],
  revenue: ["revenue", "amount", "total", "montant", "ca", "sales", "ventes", "iroadat"],
  expense: ["expense", "depense", "charges", "frais"],
  tax: ["tax", "vat", "tva"],
  account: ["account", "compte"],
  patient: ["patient", "patient_id", "mrid", "dossier", "numpatient"],
  supplier: ["supplier", "distributor", "fournisseur", "grossiste", "wholesaler", "vendor"],
  purchase_date: ["purchase_date", "date_de_l_achat", "order_date", "datefacture"],
  purchase_qty: ["purchase_qty", "qty_purchased", "received_qty", "quantity_purchased"],
  purchase_cost: ["purchase_cost", "purchase_price", "buy_price", "prix_achat"],
  purchase_order: ["purchase_order", "po_number", "po", "purchase_order_no"],
  city: ["city", "ville", "town", "المدينة"],
  country: ["country", "pays", "land", "البلد"],
  region: ["region", "governorate", "district", "province", "محافظة", "منطقة"],
  latitude: ["latitude", "lat", "عرض"],
  longitude: ["longitude", "lng", "lon", "طول"],
  budget: ["budget", "target", "target_amount", "plan_amount", "الهدف", "الميزانية"],
  opening_stock: ["opening_stock", "opening", "stock_of_beginning", "purchases", "أول_المدة"],
  closing_stock: ["closing_stock", "closing", "ending_inventory", "stock_of_end", "آخر_المدة"],
  batch: ["batch", "batch_no", "lot", "lot_no", "الدفعة", "تشغيلة"],
  counted_qty: ["counted_qty", "physical_count", "qty_counted", "كمية_الجرد", "العدد_الفعلي"],
  sales_rep: ["sales_rep", "sales_person", "representative", "مندوب_المبيعات"],
  sales_team: ["sales_team", "team", "sales_region", "فريق_المبيعات"],
};

/** Resolve a column key for a role: explicit role map → def.role → key fallback. */
export function resolveRoleKey(
  defs: ColumnDef[],
  role: ColumnRole,
  roles: Partial<Record<ColumnRole, string>>,
): string | null {
  const explicit = roles[role];
  if (explicit) return explicit;
  const stamped = defs.find((c) => c.role === role);
  if (stamped) return stamped.key;
  const norm = (s: string) =>
    s.toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  // A column already stamped with a *different* role must not be reused for
  // this role via label/key fallback (e.g. a purchase_qty column labelled
  // "Qty" must not resolve as the sales `qty` role).
  const fallbackPool = defs.filter((c) => !c.role || c.role === role);
  for (const candidate of KEY_FALLBACKS[role]) {
    const hit = fallbackPool.find((c) => norm(c.key) === norm(candidate) || norm(c.label) === norm(candidate));
    if (hit) return hit.key;
  }
  return null;
}

const INVENTORY_KEYS: { field: keyof InventoryLine; candidates: string[] }[] = [
  { field: "expiry_date", candidates: ["expiry_date", "expires_on", "expiration", "expiry", "peremption", "péremption"] },
  { field: "stock_on_hand", candidates: ["stock_on_hand", "stock", "qty_on_hand", "quantity_on_hand", "onhand", "remanence"] },
  { field: "unit_cost", candidates: ["unit_cost", "cost", "prixachat", "avg_cost"] },
];

export function resolveInventoryColumn(defs: ColumnDef[], field: keyof InventoryLine): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const c of defs) {
    if (norm(c.key) === field || norm(c.label) === field) return c.key;
  }
  const spec = INVENTORY_KEYS.find((k) => k.field === field);
  if (!spec) return null;
  for (const candidate of spec.candidates) {
    const hit = defs.find((c) => norm(c.key) === norm(candidate) || norm(c.label).includes(norm(candidate)));
    if (hit) return hit.key;
  }
  return null;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** Project opaque rows into the typed shapes the modules consume. */
export function projectRows(
  defs: ColumnDef[],
  rows: Record<string, unknown>[],
  roles: Partial<Record<ColumnRole, string>>,
): ProjectedRows {
  const key = (role: ColumnRole) => resolveRoleKey(defs, role, roles) ?? null;

  const dateKey = key("date");
  const txnKey = key("transaction_id");
  const productKey = key("product");
  const categoryKey = key("category");
  const qtyKey = key("qty");
  const unitPriceKey = key("unit_price");
  const revenueKey = key("revenue");
  const patientKey = key("patient");
  const branchKey = key("branch");
  const refundKey = key("refund");
  const repKey = key("sales_rep");
  const teamKey = key("sales_team");
  const supplierKey = key("supplier");
  const purchaseDateKey = key("purchase_date");
  const purchaseQtyKey = key("purchase_qty");
  const purchaseCostKey = key("purchase_cost");
  const purchaseOrderKey = key("purchase_order");
  const cityKey = key("city");
  const countryKey = key("country");
  const regionKey = key("region");
  const latKey = key("latitude");
  const lngKey = key("longitude");
  const budgetKey = key("budget");
  const countedKey = key("counted_qty");
  const batchKey = key("batch");

  const expiryKey = resolveInventoryColumn(defs, "expiry_date");
  const stockKey = resolveInventoryColumn(defs, "stock_on_hand");
  const costKey = resolveInventoryColumn(defs, "unit_cost");

  const sales = rows.map((raw) => {
    const units = qtyKey ? num(raw[qtyKey]) : 1;
    const amtRevenue = revenueKey ? num(raw[revenueKey]) : 0;
    const amtPrice = unitPriceKey ? num(raw[unitPriceKey]) * units : 0;
    const amount = revenueKey ? amtRevenue : amtPrice;
    const product = (raw[productKey ?? ""] as string) ?? "(no product)";
    const refunded =
      (refundKey && raw[refundKey] != null && raw[refundKey] !== "" && Number(num(raw[refundKey])) !== 0) ||
      amount < 0 ||
      units < 0;
    const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
    return {
      customer_id: str(raw[patientKey ?? ""]),
      date: dateKey ? String(raw[dateKey] ?? "") : "",
      transaction_id: str(raw[txnKey ?? ""]),
      product,
      category: str(raw[categoryKey ?? ""]),
      amount,
      units,
      branch: str(raw[branchKey ?? ""]),
      refunded,
      rep: str(raw[repKey ?? ""]),
      team: str(raw[teamKey ?? ""]),
      raw,
    };
  });

const hasInventory = expiryKey !== null || stockKey !== null;
  const inventory: InventoryLine[] = hasInventory
    ? rows.map((raw) => ({
        product: String(raw[productKey ?? ""] ?? "(no product)"),
        sku: raw[resolveRoleKey(defs, "sku", roles) ?? ""] != null ? String(raw[resolveRoleKey(defs, "sku", roles) ?? ""]) : null,
        batch: batchKey && raw[batchKey] != null ? String(raw[batchKey]) : null,
        expiry_date: expiryKey ? (raw[expiryKey] != null ? String(raw[expiryKey]) : null) : null,
        stock_on_hand: stockKey ? num(raw[stockKey]) : 0,
        unit_cost: costKey ? num(raw[costKey]) : null,
      }))
    : [];

  const purchases: PurchaseLine[] = rows.map((raw) => {
    const qty = purchaseQtyKey ? num(raw[purchaseQtyKey]) : 0;
    const unitCost = purchaseCostKey ? num(raw[purchaseCostKey]) : null;
    const cost = unitCost !== null ? (purchaseQtyKey ? unitCost * qty : unitCost) : 0;
    const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
    return {
      supplier: str(raw[supplierKey ?? ""]),
      date: purchaseDateKey ? String(raw[purchaseDateKey] ?? "") : "",
      order: str(raw[purchaseOrderKey ?? ""]),
      product: str(raw[productKey ?? ""]),
      qty,
      cost,
      unit_cost: unitCost,
    };
  });

  const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = num(v);
    return Number.isFinite(n) ? n : null;
  };
  const geo: GeoLine[] = rows.map((raw) => ({
    city: str(raw[cityKey ?? ""]),
    region: str(raw[regionKey ?? ""]),
    country: str(raw[countryKey ?? ""]),
    lat: numOrNull(raw[latKey ?? ""]),
    lng: numOrNull(raw[lngKey ?? ""]),
    customer: str(raw[patientKey ?? ""]),
    amount: revenueKey ? num(raw[revenueKey]) : unitPriceKey ? num(raw[unitPriceKey]) * (qtyKey ? num(raw[qtyKey]) : 1) : 0,
    units: qtyKey ? num(raw[qtyKey]) : 0,
  }));

  const periodIfAny = (d: unknown): string => (d == null || d === "" ? "" : String(d).slice(0, 7));
  const budgets: BudgetLine[] = rows
    .filter((raw) => budgetKey && raw[budgetKey] != null && raw[budgetKey] !== "")
    .map((raw) => ({
      period: dateKey ? periodIfAny(raw[dateKey]) : "",
      category: str(raw[categoryKey ?? ""]),
      branch: str(raw[branchKey ?? ""]),
      budget: num(raw[budgetKey ?? ""]),
      actual: revenueKey ? num(raw[revenueKey]) : 0,
      units: qtyKey ? num(raw[qtyKey]) : 0,
    }));

  const counts: StocktakeLine[] = countedKey
    ? rows
        .filter((raw) => raw[countedKey] != null && raw[countedKey] !== "")
        .map((raw) => ({
          product: String(raw[productKey ?? ""] ?? "(no product)"),
          batch: str(raw[batchKey ?? ""]),
          counted_qty: num(raw[countedKey]),
        }))
    : [];
  const system: SystemStockLine[] = rows
    .filter((raw) => (stockKey && raw[stockKey] != null && raw[stockKey] !== "") || countedKey)
    .map((raw) => ({
      product: String(raw[productKey ?? ""] ?? "(no product)"),
      batch: str(raw[batchKey ?? ""]),
      system_qty: stockKey ? num(raw[stockKey]) : 0,
      unit_cost: costKey ? num(raw[costKey]) : null,
    }));

  return { sales, inventory, purchases, geo, budgets, stocktake: { counts, system } };
}

/** Distinct transactions per day + amount per line, for basket + benchmark. */
export function buildSuite(
  defs: ColumnDef[],
  rows: Record<string, unknown>[],
  opts: SuiteRunOptions = {},
): PharmacySuite {
  const { roles = {}, kind = null, forecastMetric = "units", forecastHorizon = 14 } = opts;
  const projected = projectRows(defs, rows, roles);
  const sales = projected.sales;

  const dateKey = resolveRoleKey(defs, "date", roles) ?? null;
  const txnKey = resolveRoleKey(defs, "transaction_id", roles) ?? null;
  const productKey = resolveRoleKey(defs, "product", roles) ?? null;
  const qtyKey = resolveRoleKey(defs, "qty", roles) ?? null;
  const revenueKey = resolveRoleKey(defs, "revenue", roles) ?? null;
  const unitPriceKey = resolveRoleKey(defs, "unit_price", roles) ?? null;
  const patientKey = resolveRoleKey(defs, "patient", roles) ?? null;
  const categoryKey = resolveRoleKey(defs, "category", roles) ?? null;
  const costKey = resolveRoleKey(defs, "cost", roles) ?? null;

  // ---- RFM ----
  let rfm: ModuleState<RfmModuleResult>;
  if (!dateKey) {
    rfm = { available: false, reason: "No date column — recency cannot be computed." };
  } else if (!patientKey && !txnKey) {
    rfm = { available: false, reason: "No customer or transaction identifier — RFM needs something to group by." };
  } else {
    rfm = {
      available: true,
      result: {
        segmentation: runRfm(
          sales.map((l) => ({
            customer_id: l.customer_id ?? (txnKey && l.transaction_id ? `${l.transaction_id}#row` : null),
            date: l.date,
            transaction_id: l.transaction_id,
            amount: l.amount,
          })),
        ),
      },
    };
  }

  // ---- Basket ----
  let basket: ModuleState<BasketModuleResult>;
  if (!txnKey || !productKey) {
    basket = { available: false, reason: "Basket analysis needs transaction_id + product columns." };
  } else {
    basket = {
      available: true,
      result: {
        marketBasket: runBasket(
          sales.map((l) => ({ transaction_id: l.transaction_id, product: l.product, amount: l.amount })),
        ),
      },
    };
  }

  // ---- ABC-XYZ (needs product + revenue-ish + daily qty) ----
  const demandRows: DemandRow[] = [];
  const revenueRows: ProductRevenue[] = [];
  if (productKey && revenueKey) {
    const revMap = new Map<string, number>();
    for (const l of sales) {
      revMap.set(l.product, (revMap.get(l.product) ?? 0) + l.amount);
    }
    for (const [product, revenue] of revMap) revenueRows.push({ product, revenue });
  } else if (productKey && qtyKey && unitPriceKey) {
    const revMap = new Map<string, number>();
    for (const l of sales) {
      revMap.set(l.product, (revMap.get(l.product) ?? 0) + l.amount);
    }
    for (const [product, revenue] of revMap) revenueRows.push({ product, revenue });
  }
  if (productKey && qtyKey && dateKey) {
    for (const l of sales) {
      if (l.date == null || l.date === "") continue;
      demandRows.push({ product: l.product, day: String(l.date), units: l.units });
    }
  }

  let abcXyz: ModuleState<ReturnType<typeof runAbcXyz>>;
  if (revenueRows.length === 0) {
    abcXyz = { available: false, reason: "ABC needs a revenue signal (revenue column, or qty × unit price)." };
  } else if (demandRows.length === 0) {
    abcXyz = { available: false, reason: "XYZ needs daily sales history (date + qty columns)." };
  } else {
    abcXyz = { available: true, result: runAbcXyz(revenueRows, demandRows) };
  }

  // ---- Safety stock (reuses the same daily demand) ----
  let safetyStock: ModuleState<ReturnType<typeof runSafetyStock>>;
  if (demandRows.length === 0) {
    safetyStock = { available: false, reason: "Safety stock needs daily demand (date + qty columns)." };
  } else {
    const byProduct = demandSeriesByProduct(demandRows);
    safetyStock = { available: true, result: runSafetyStock(byProduct) };
  }

  // ---- Expiry (inventory dataset only) ----
  let expiry: ModuleState<ReturnType<typeof runExpiry>>;
  const expiryCol = resolveInventoryColumn(defs, "expiry_date");
  const stockCol = resolveInventoryColumn(defs, "stock_on_hand");
  if (!expiryCol && !stockCol) {
    expiry = { available: false, reason: "Expiry tracking needs an inventory dataset (expiry_date / stock_on_hand columns)." };
  } else {
    const perProduct = new Map<string, number>();
    for (const d of demandRows) perProduct.set(d.product, (perProduct.get(d.product) ?? 0) + d.units);
    const dayCounts = new Map<string, Set<string>>();
    for (const d of demandRows) {
      const s = dayCounts.get(d.product) ?? new Set<string>();
      s.add(String(d.day));
      dayCounts.set(d.product, s);
    }
    const demandAvg: DemandForProduct[] = [];
    for (const [product, total] of perProduct) {
      demandAvg.push({ product, avg_daily_units: total / Math.max(1, dayCounts.get(product)?.size ?? 1) });
    }
    expiry = {
      available: true,
      result: runExpiry(projected.inventory, demandAvg),
    };
  }

  // ---- Forecast ----
  let forecast: ModuleState<ForecastModuleResult>;
  if (!dateKey) {
    forecast = { available: false, reason: "Forecasting needs a date column." };
  } else {
    const valueKey = forecastMetric === "revenue" ? (revenueKey ?? unitPriceKey) : qtyKey;
    if (!valueKey) {
      forecast = { available: false, reason: `Forecast metric "${forecastMetric}" needs ${forecastMetric === "revenue" ? "revenue" : "qty(units)"} column.` };
    } else {
      const nightly = new Map<string, number>();
      for (const l of sales) {
        const day = String(l.date).slice(0, 10);
        nightly.set(day, (nightly.get(day) ?? 0) + (forecastMetric === "revenue" ? l.amount : l.units));
      }
      const points: ForecastPoint[] = [...nightly.entries()].map(([date, value]) => ({ date, value }));
      forecast = { available: true, result: { forecast: runForecast(points, { horizon: forecastHorizon }) } };
    }
  }

  // ---- Benchmark rollups (opt-in; patient column hashed at sync time) ----
  let benchmark: ModuleState<BenchmarkModuleResult>;
  if (!dateKey || (!revenueKey && !unitPriceKey && !qtyKey)) {
    benchmark = { available: false, reason: "Benchmark rollups need date + a monetary/qty column." };
  } else {
    const rowsForBenchmark = sales.map((l) => ({
      branch: l.branch,
      date: l.date,
      amount: l.amount,
      units: l.units,
      txn: l.transaction_id,
      product: l.product,
    }));
    benchmark = {
      available: true,
      result: {
        daily: dailyRollups(rowsForBenchmark),
        categories: categoryRollups(
          sales.map((l) => ({ category: l.category, amount: l.amount, units: l.units })),
        ),
        patient_count: new Set(sales.map((s) => s.customer_id).filter(Boolean)).size,
        hashed_patients: Boolean(patientKey),
      },
    };
  }

  // ---- Sales lens (تحليل البيع) ----
  let salesLens: ModuleState<SalesLensModuleResult>;
  if (!qtyKey && !revenueKey && !unitPriceKey) {
    salesLens = { available: false, reason: "Sales lens needs a qty, revenue, or unit-price column." };
  } else {
    salesLens = {
      available: true,
      result: {
        sales: runSalesLens(
          sales.map((l) => ({
            date: String(l.date),
            product: l.product,
            category: l.category,
            amount: l.amount,
            units: l.units,
            transaction_id: l.transaction_id,
            refunded: l.refunded,
            rep: l.rep,
            team: l.team,
          })),
        ),
      },
    };
  }

  // ---- Supplier lens (تحليل الموردين) ----
  let supplier: ModuleState<SupplierModuleResult>;
  const supplierKey = resolveRoleKey(defs, "supplier", roles) ?? null;
  if (!supplierKey) {
    supplier = { available: false, reason: "Supplier lens needs a supplier/distributor column (purchases sheet)." };
  } else {
    supplier = { available: true, result: { suppliers: runSupplierLens(projected.purchases) } };
  }

  // ---- Geography lens (تحليل جغرافي) ----
  const cityRole = resolveRoleKey(defs, "city", roles) ?? null;
  const countryRole = resolveRoleKey(defs, "country", roles) ?? null;
  const regionRole = resolveRoleKey(defs, "region", roles) ?? null;
  const latRole = resolveRoleKey(defs, "latitude", roles) ?? null;
  const lngRole = resolveRoleKey(defs, "longitude", roles) ?? null;
  let geography: ModuleState<GeographyModuleResult>;
  if (!cityRole && !countryRole && !regionRole && (!latRole || !lngRole)) {
    geography = { available: false, reason: "Geography lens needs a city, region, country, or lat/lng column." };
  } else {
    geography = { available: true, result: { geography: runGeography(projected.geo) } };
  }

  // ---- Budget lens (الموازنات المالية) ----
  let budget: ModuleState<BudgetModuleResult>;
  const budgetRole = resolveRoleKey(defs, "budget", roles) ?? null;
  if (!budgetRole) {
    budget = { available: false, reason: "Budget lens needs a budget/target column (budget sheet)." };
  } else {
    budget = { available: true, result: { budget: runBudget(projected.budgets) } };
  }

  // ---- Stock-count lens (الجرد الفعلي) ----
  const countedRole = resolveRoleKey(defs, "counted_qty", roles) ?? null;
  let stocktake: ModuleState<StocktakeModuleResult>;
  if (!countedRole) {
    stocktake = { available: false, reason: "Stock count lens needs a counted-qty column (count sheet)." };
  } else {
    stocktake = { available: true, result: { stocktake: runStocktake(projected.stocktake.counts, projected.stocktake.system) } };
  }

  const roleMap: Partial<Record<ColumnRole, string>> = {
    date: dateKey ?? undefined,
    transaction_id: txnKey ?? undefined,
    product: productKey ?? undefined,
    category: categoryKey ?? undefined,
    qty: qtyKey ?? undefined,
    unit_price: unitPriceKey ?? undefined,
    revenue: revenueKey ?? undefined,
    cost: costKey ?? undefined,
    patient: patientKey ?? undefined,
    branch: resolveRoleKey(defs, "branch", roles) ?? undefined,
    supplier: resolveRoleKey(defs, "supplier", roles) ?? undefined,
    purchase_date: resolveRoleKey(defs, "purchase_date", roles) ?? undefined,
    purchase_qty: resolveRoleKey(defs, "purchase_qty", roles) ?? undefined,
    purchase_cost: resolveRoleKey(defs, "purchase_cost", roles) ?? undefined,
    purchase_order: resolveRoleKey(defs, "purchase_order", roles) ?? undefined,
    city: resolveRoleKey(defs, "city", roles) ?? undefined,
    country: resolveRoleKey(defs, "country", roles) ?? undefined,
    region: resolveRoleKey(defs, "region", roles) ?? undefined,
    latitude: resolveRoleKey(defs, "latitude", roles) ?? undefined,
    longitude: resolveRoleKey(defs, "longitude", roles) ?? undefined,
    budget: resolveRoleKey(defs, "budget", roles) ?? undefined,
    opening_stock: resolveRoleKey(defs, "opening_stock", roles) ?? undefined,
    closing_stock: resolveRoleKey(defs, "closing_stock", roles) ?? undefined,
    batch: resolveRoleKey(defs, "batch", roles) ?? undefined,
    counted_qty: resolveRoleKey(defs, "counted_qty", roles) ?? undefined,
    sales_rep: resolveRoleKey(defs, "sales_rep", roles) ?? undefined,
    sales_team: resolveRoleKey(defs, "sales_team", roles) ?? undefined,
  };

  return {
    generatedAt: new Date().toISOString(),
    kind: projected.inventory.length > 0 && kind !== "sales" ? "inventory" : kind,
    rows: rows.length,
    columns: defs.map((c) => ({ key: c.key, label: c.label, type: c.type })),
    roleMap,
    modules: { sales: salesLens, supplier, geography, budget, stocktake, rfm, basket, abcXyz, safetyStock, expiry, forecast, benchmark },
  };
}