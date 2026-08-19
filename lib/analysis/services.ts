import type { ColumnRole } from "@/lib/types";
import { roleLabel } from "./roles";

/**
 * The nine SiroQ consulting/operational service lines (as agreed with the
 * client) mapped to the column roles each service needs. A dataset (or a set
 * of datasets within an organization) is "service-ready" when all `required`
 * roles resolve; `optional` roles improve depth.
 *
 * Used for:
 *   1. the upload confirmation step (what this file can already power),
 *   2. the operator's per-organization data-completeness report,
 *   3. the "ask the client for missing data" checklist (delivery queue).
 */

export const SERVICE_IDS = [
  "sales",
  "inventory",
  "customers",
  "suppliers",
  "geography",
  "benchmarks",
  "forecasting",
  "budgets",
  "stocktake",
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

export interface ServiceDefinition {
  id: ServiceId;
  /** Arabic service name as requested by the client. */
  nameAr: string;
  name: string;
  description: string;
  required: ColumnRole[];
  optional: ColumnRole[];
  /** Human guidance on the data that feeds this service. */
  note?: string;
}

export const SERVICES: ServiceDefinition[] = [
  {
    id: "sales",
    nameAr: "تحليل البيع",
    name: "Sales analysis",
    description: "Revenue, units, category mix, periods and product performance.",
    required: ["date", "product", "qty"],
    optional: ["revenue", "unit_price", "category", "transaction_id", "branch", "refund", "sales_rep", "sales_team"],
  },
  {
    id: "inventory",
    nameAr: "تحليل المخزون",
    name: "Inventory analysis",
    description: "ABC/XYZ classification, safety stock, expiry risk, dead stock, reorder.",
    required: ["product", "qty"],
    optional: ["date", "cost", "sku", "batch", "opening_stock", "closing_stock", "unit_price"],
    note: "Add expiry_date / stock-on-hand columns and a sales history for full coverage.",
  },
  {
    id: "customers",
    nameAr: "تحليل العملاء",
    name: "Customer analysis",
    description: "RFM segmentation, revenue concentration and repeat-purchase behaviour.",
    required: ["transaction_id"],
    optional: ["patient", "date", "revenue", "unit_price", "qty", "account", "city", "branch"],
    note: "A patient/customer identifier or a transaction/invoice number is required.",
  },
  {
    id: "suppliers",
    nameAr: "تحليل الموردين",
    name: "Supplier analysis",
    description: "Spend by supplier, purchase history, price paid and concentration risk.",
    required: ["supplier"],
    optional: ["purchase_date", "purchase_qty", "purchase_cost", "purchase_order", "product", "date", "qty"],
    note: "Feed this from a purchases/orders sheet naming the supplier.",
  },
  {
    id: "geography",
    nameAr: "تحليل جغرافي",
    name: "Geographic analysis",
    description: "Sales, customers and stock by city / region / country on a map.",
    required: ["city", "country", "region", "latitude", "longitude"],
    optional: [],
  },
  {
    id: "benchmarks",
    nameAr: "المقارنات المرجعية",
    name: "Benchmarks",
    description: "This pharmacy vs opted-in market averages (daily revenue, transactions, margins).",
    required: ["date"],
    optional: ["branch", "revenue", "unit_price", "qty", "category"],
    note: "Market comparison requires the pharmacy to opt in on the Benchmark tab.",
  },
  {
    id: "forecasting",
    nameAr: "التنبؤ بالمبيعات",
    name: "Forecasting",
    description: "Daily demand forecast (units / revenue) with horizon + confidence band.",
    required: ["date"],
    optional: ["qty", "revenue", "unit_price", "product"],
  },
  {
    id: "budgets",
    nameAr: "الموازنات المالية",
    name: "Financial budgets",
    description: "Budget vs actual by category and month: variance, burn rate, attainment.",
    required: ["budget"],
    optional: ["date", "category", "branch", "revenue", "account"],
    note: "Import a budget sheet (period, category, target amount) alongside sales.",
  },
  {
    id: "stocktake",
    nameAr: "الجرد الفعلي",
    name: "Physical stock count",
    description: "Count sheets, counted-vs-system variance and audited adjustments.",
    required: ["product", "counted_qty"],
    optional: ["qty", "batch", "unit_price", "cost", "date", "branch"],
    note: "Import stock-count sheets; the system stock comes from the inventory dataset.",
  },
];

export interface ServiceCoverage {
  id: ServiceId;
  name: string;
  nameAr: string;
  description: string;
  available: boolean;
  /** Roles that resolved for this service. */
  present: { role: ColumnRole; label: string }[];
  /** Required roles that did not resolve. */
  missing: { role: ColumnRole; label: string }[];
}

/** Resolvable roles (keys with a column mapping) excluding empty strings. */
function resolvedRoles(roleMap: Partial<Record<ColumnRole, string>>): Set<ColumnRole> {
  const out = new Set<ColumnRole>();
  for (const [role, key] of Object.entries(roleMap)) {
    if (key) out.add(role as ColumnRole);
  }
  return out;
}

/**
 * Given the resolved role map of one dataset (or the union across an
 * organization's datasets), report which of the nine services are computable
 * and what is missing. `geography` is an OR-gate: any geo column (city,
 * country, region, or coordinates) makes it available.
 */
export function assessServiceCoverage(
  roleMap: Partial<Record<ColumnRole, string>>,
): ServiceCoverage[] {
  const resolved = resolvedRoles(roleMap);
  const hasCoords = resolved.has("latitude") || resolved.has("longitude");

  return SERVICES.map((svc) => {
    if (svc.id === "geography") {
      const present: { role: ColumnRole; label: string }[] = [];
      for (const role of ["city", "country", "region"] as ColumnRole[]) {
        if (resolved.has(role)) present.push({ role, label: roleLabel(role) });
      }
      if (hasCoords) {
        present.push({ role: "latitude", label: roleLabel("latitude") });
        present.push({ role: "longitude", label: roleLabel("longitude") });
      }
      return {
        id: svc.id,
        name: svc.name,
        nameAr: svc.nameAr,
        description: svc.description,
        available: present.length > 0,
        present,
        missing: present.length === 0
          ? (["city", "country", "region"] as ColumnRole[]).map((role) => ({
              role,
              label: roleLabel(role),
            }))
          : [],
      };
    }

    const present = svc.required
      .filter((r) => resolved.has(r))
      .map((role) => ({ role, label: roleLabel(role) }));
    const missing = svc.required
      .filter((r) => !resolved.has(r))
      .map((role) => ({ role, label: roleLabel(role) }));

    return {
      id: svc.id,
      name: svc.name,
      nameAr: svc.nameAr,
      description: svc.description,
      available: missing.length === 0,
      present,
      missing,
    };
  });
}

/** English labels for the services (used in the operator UI). */
export function serviceLabel(id: ServiceId | string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id;
}