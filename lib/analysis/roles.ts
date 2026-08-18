import type { ColumnDef, ColumnRole, ColumnType, RoleConfidence } from "@/lib/types";
import { parseNumericValue } from "@/lib/coerce";

export interface RoleAssignment {
  role: ColumnRole;
  confidence: RoleConfidence;
  reason: string;
}

export interface ColumnSample {
  type: ColumnType;
  values: (string | null)[];
  distinct: number;
  nonNullCount: number;
  totalRows: number;
  colIndex: number;
}

// Header-token lexicon, multilingual (en/fr/de/ar + pharma vocabulary).
const TOKEN_LEXICON: Record<ColumnRole, string[]> = {
  date: [
    "date", "datum", "datums", "jour", "journee", "datevente",
    "transactiondate", "salesdate", "facturedate", "crna",
  ],
  branch: [
    "branch", "branche", "filiale", "store", "magasin", "shop", "site",
    "pharmacy", "pharmacie", "apotheke", "succursale", "agence",
    "pointdevente", "pdv", "standort",
  ],
  transaction_id: [
    "transaction", "transactionid", "txn", "txnid", "invoice", "invoiceid",
    "facture", "factureno", "receipt", "recu", "bon", "bonno", "ticket",
    "ticketno", "order", "orderid", "orderno", "commande", "numerofacture",
    "nofacture", "docno", "reference", "ref", "mouvementid",
  ],
  product: [
    "product", "produit", "item", "itemname", "article", "articlecode",
    "drug", "drugname", "medicament", "medicine", "medication", "designation",
    "libelle", "name", "nom", "intitule", "noticename", "skulabel",
  ],
  category: [
    "category", "categorie", "cat", "catal", "class", "classe", "group",
    "groupe", "family", "famille", "department", "rayon", "section", "type",
    "segment", "t9neyf",
  ],
  qty: [
    "qty", "quantity", "quantite", "qt", "qte", "count", "units", "pieces",
    "noofunits", "stockqty", "packsize", "menge", "kammia", "kamya",
  ],
  unit_price: [
    "unitprice", "unit_price", "price", "prix", "prixunitaire", "pu", "rate",
    "tarif", "sellingprice", "prixvente", "montantht", "ss3r", "se3r",
  ],
  cost: [
    "cost", "unitcost", "cout", "couts", "costprice", "prixachat",
    "prixdachat", "cog", "cogs", "achat", "purchaseprice", "t3omira",
    "ka2ifa", "kolfa",
  ],
  refund: [
    "refund", "refundamount", "remboursement", "return", "retour", "avoir",
    "remise", "rrd", "sti3ad", "mordoudat",
  ],
  sku: [
    "sku", "ean", "ean13", "barcode", "upc", "gtin", "code", "codebarre",
    "codearticle", "articleid", "sku_code", "r9m", "barqod",
  ],
  revenue: [
    "revenue", "revenu", "sales", "turnover", "chiffredaffaires", "ca",
    "income", "recette", "receves", "ventes", "total", "montant", "gross",
    "brut", "iroadat", "madakhil",
  ],
  expense: [
    "expense", "expenses", "depense", "depenses", "overhead", "charges",
    "charge", "chargeht", "frais", "analysisexpense", "masarif",
  ],
  tax: [
    "tax", "vat", "tva", "salestax", "taxamount", "taxes", "impot", "taxe",
    "tvasurventes", "tn7", "dariba",
  ],
  account: [
    "account", "compte", "accountnumber", "numerocompte", "acct", "ledger",
    "hissab",
  ],
  patient: [
    "patient", "patientid", "patient_id", "npatient", "numpatient",
    "client_mrid", "dossier", "dossierpatient", "mrid", "mrayad",
  ],
};

const TOKEN_INDEX: Map<string, ColumnRole> = new Map();
for (const [role, tokens] of Object.entries(TOKEN_LEXICON)) {
  for (const t of tokens) {
    TOKEN_INDEX.set(t, role as ColumnRole);
  }
}

export function normalizeHeader(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function headerExactMatch(label: string): ColumnRole | null {
  return TOKEN_INDEX.get(normalizeHeader(label)) ?? null;
}

function headerSubstringMatch(label: string): ColumnRole | null {
  const norm = normalizeHeader(label);
  // priority: money-ish composites before generic single tokens so a
  // "Sales Total" doesn't fall through to qty or total->revenue by accident
  if (/refund|retour|avoir|remboursement|rrd|mordoudat/.test(norm)) return "refund";
  if (/patient|mrid|dossier/.test(norm)) return "patient";
  if (/invoice|facture|transaction|ticket|receipt|recu|bonno/.test(norm)) {
    return "transaction_id";
  }
  if (/ean|barcode|code.?barre|sku|upc|gtin/.test(norm)) return "sku";
  for (const role of Object.keys(TOKEN_LEXICON) as ColumnRole[]) {
    if (TOKEN_LEXICON[role].some((t) => norm.includes(t) && t.length >= 3)) {
      return role;
    }
  }
  return null;
}

// -- Value-shape signals (independent of headers) -------------------------

const CURRENCY_RE = /[$€£¥₺]/;
const DECIMAL_COMMA_RE = /^\d{1,3}(?:[.]\d{3})*(?:,\d{1,2})?$/;
const EAN13_RE = /^\d{13}$/;

function looksLikeAmount(value: string): boolean {
  const t = value.trim();
  if (/^[-+]?\d+([.,]\d{1,3})?$/.test(t)) return true;
  return CURRENCY_RE.test(t) || DECIMAL_COMMA_RE.test(t);
}

function countWhere(values: (string | null)[], predicate: (v: string) => boolean): number {
  let n = 0;
  for (const v of values) {
    if (v && predicate(v)) n += 1;
  }
  return n;
}

function parseNumericStrict(value: string): number | null {
  return parseNumericValue(value);
}

function numericValues(values: (string | null)[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!v) continue;
    const n = parseNumericStrict(v);
    if (n !== null) out.push(n);
  }
  return out;
}

// -- Inference -----------------------------------------------------------

export function inferRole(
  label: string,
  sample: ColumnSample,
): RoleAssignment | null {
  const exact = headerExactMatch(label);
  const headerRole = exact ?? headerSubstringMatch(label);

  if (headerRole) {
    return { role: headerRole, confidence: "high", reason: `header "${label}"` };
  }

  // data-driven heuristics
  const nonEmpty = sample.values.filter((v): v is string => Boolean(v?.trim()));
  if (nonEmpty.length === 0) return null;

  const matches = (s: string, re: RegExp) => re.test(s.trim());

  if (sample.type === "date") {
    return { role: "date", confidence: "high", reason: "parsed as date" };
  }
  if (sample.type === "boolean") {
    return null;
  }

  // EAN-13 / code-like column
  const eanRatio = countWhere(nonEmpty, (v) => matches(v, EAN13_RE)) / Math.max(1, nonEmpty.length);
  if (sample.type === "string" && eanRatio > 0.8) {
    return { role: "sku", confidence: "high", reason: "EAN-13 barcode value shape" };
  }

  // distinct≈rows → id-ish
  const nonNull = sample.nonNullCount || nonEmpty.length;
  const distinctRatio = sample.totalRows > 0 ? (sample.distinct || 1) / Math.max(1, nonNull) : 1;
  if (distinctRatio > 0.95 && sample.type === "string") {
    const lenAvg =
      nonEmpty.reduce((a, v) => a + v.length, 0) / Math.max(1, nonEmpty.length);
    if (lenAvg >= 8) {
      return {
        role: "transaction_id",
        confidence: "medium",
        reason: "high-cardinality long identifiers",
      };
    }
  }

  // small non-negative integers first (qty), before the money branch
  if (sample.type === "numeric") {
    const nums = numericValues(nonEmpty);
    if (nums.length > 0) {
      const ints = nums.filter((n) => Number.isInteger(n) && n >= 0);
      if (ints.length / Math.max(1, nums.length) > 0.8) {
        const maxInt = Math.max(...ints);
        if (maxInt <= 1000) {
          return { role: "qty", confidence: "medium", reason: "small non-negative integers" };
        }
      }
    }
  }

  // money column: amounts present and predominantly non-integer decimals
  if (sample.type === "numeric" || sample.type === "string") {
    const nums = numericValues(nonEmpty);
    if (nums.length > 0) {
      const amountsRatio = countWhere(nonEmpty, looksLikeAmount) / Math.max(1, nonEmpty.length);
      if (amountsRatio > 0.6) {
        const minAbs = Math.min(...nums.map((n) => Math.abs(n)));
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        if (avg <= 0) {
          return { role: "revenue", confidence: "medium", reason: "aggregate money-like column" };
        }
        // negative skew + small -> refund; money (non-integer) -> price
        if (minAbs < 1000 && nums.some((n) => n % 1 !== 0)) {
          if (minAbs < 500 && avg > 0 && nums.some((n) => n < 0)) {
            return { role: "refund", confidence: "low", reason: "negative small monetary values" };
          }
          return {
            role: "unit_price",
            confidence: "medium",
            reason: "decimal monetary values shaped like a price",
          };
        }
        if (nums.some((n) => n < 0)) {
          return { role: "refund", confidence: "low", reason: "contains negative amounts" };
        }
        return {
          role: "revenue",
          confidence: "medium",
          reason: "aggregate monetary amounts",
        };
      }
    }
  }

  // categorical short strings
  if (sample.type === "string") {
    const lenAvg =
      nonEmpty.reduce((a, v) => a + v.length, 0) / Math.max(1, nonEmpty.length);
    if (distinctRatio < 0.2 && lenAvg < 25) {
      return { role: "category", confidence: "medium", reason: "low-cardinality short text" };
    }
  }

  return null;
}

export interface RoleMapResult {
  role: ColumnRole;
  confidence: RoleConfidence;
  reason: string;
  key: string;
  label: string;
}

// Assign roles to all columns, resolving collisions deterministically:
// exact header wins, then higher confidence, then earlier column index.
export function inferRoles(
  defs: ColumnDef[],
  samples: Record<string, ColumnSample>,
): RoleMapResult[] {
  const results: RoleMapResult[] = [];
  const byRole = new Map<ColumnRole, RoleMapResult>();

  for (const def of defs) {
    const sample = samples[def.key];
    if (!sample) continue;
    const assignment = inferRole(def.label, sample);
    if (!assignment) continue;
    const entry: RoleMapResult = {
      role: assignment.role,
      confidence: assignment.confidence,
      reason: assignment.reason,
      key: def.key,
      label: def.label,
    };

    const existing = byRole.get(entry.role);
    if (!existing) {
      byRole.set(entry.role, entry);
      results.push(entry);
      continue;
    }
    // resolve collision: keep the better one
    const rank = (c: RoleConfidence) => (c === "high" ? 3 : c === "medium" ? 2 : 1);
    if (rank(entry.confidence) > rank(existing.confidence)) {
      byRole.set(entry.role, entry);
      results[results.indexOf(existing)] = entry;
    }
  }

  // `account`/`patient` should only win over an id role if explicitly labeled
  return results;
}

export function withRoleConfidence(
  defs: ColumnDef[],
  assignments: RoleMapResult[],
): ColumnDef[] {
  const byKey = new Map(assignments.map((a) => [a.key, a]));
  return defs.map((d) => {
    const a = byKey.get(d.key);
    if (!a) return d;
    return {
      ...d,
      role: a.role,
      role_confidence: a.confidence,
    };
  });
}

export function roleLabel(role: ColumnRole): string {
  const labels: Record<ColumnRole, string> = {
    date: "Date",
    branch: "Branch",
    transaction_id: "Transaction",
    product: "Product",
    category: "Category",
    qty: "Quantity",
    unit_price: "Unit price",
    cost: "Unit cost",
    refund: "Refund",
    sku: "SKU",
    revenue: "Revenue",
    expense: "Expense",
    tax: "Tax",
    account: "Account",
    patient: "Patient",
  };
  return labels[role];
}