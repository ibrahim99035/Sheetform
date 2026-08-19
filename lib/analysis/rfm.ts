import { ntileRank, round, pctShare } from "./shared";

/**
 * Customer RFM (Recency · Frequency · Monetary) using NTILE(5)-style scoring
 * and the classic 5×5→segment taxonomy. Deterministic and reversible: the
 * reference "now" is the dataset's own maximum date, so a re-run on the same
 * file yields identical buckets.
 */

export type RfmSegment =
  | "Champions"
  | "Loyal"
  | "Potential Loyalist"
  | "New Customers"
  | "Promising"
  | "Need Attention"
  | "About To Sleep"
  | "At Risk"
  | "Cannot Lose Them"
  | "Hibernating"
  | "Lost";

export interface RfmCustomer {
  customer_id: string;
  /** days between last purchase and the dataset's max date (lower = better). */
  recency_days: number;
  frequency: number;
  monetary: number;
  r: number;
  f: number;
  m: number;
  segment: RfmSegment;
}

export interface RfmSegmentStat {
  segment: RfmSegment;
  count: number;
  share_pct: number;
  avg_monetary: number;
  /** sum of the segment's monetary value (retention value at stake). */
  total_monetary: number;
}

export interface RfmResult {
  reference_date: string;
  customers: RfmCustomer[];
  segments: RfmSegmentStat[];
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export interface SalesLine {
  customer_id: string | null;
  date: string | number;
  transaction_id?: string | null;
  amount: number;
}

export interface RfmCustomerAggregate {
  customer_id: string;
  last_day: number;
  frequency: number;
  monetary: number;
}

/** Aggregate lines → per-customer (last purchase day, distinct txns, monetary). */
export function aggregateCustomers(lines: SalesLine[], maxDay: number): RfmCustomerAggregate[] {
  const byCustomer = new Map<string, { last_day: number; txns: Set<string>; monetary: number }>();
  for (const line of lines) {
    const id = line.customer_id ?? "<walk-in>";
    const day = new Date(typeof line.date === "number" ? line.date : String(line.date)).getTime();
    if (Number.isNaN(day)) continue;
    let agg = byCustomer.get(id);
    if (!agg) {
      agg = { last_day: -Infinity, txns: new Set(), monetary: 0 };
      byCustomer.set(id, agg);
    }
    if (day > agg.last_day) agg.last_day = day;
    const txn = line.transaction_id ?? id;
    agg.txns.add(String(txn));
    agg.monetary += Number.isFinite(line.amount) ? line.amount : 0;
  }
  const out: RfmCustomerAggregate[] = [];
  for (const [customer_id, a] of byCustomer) {
    out.push({
      customer_id,
      last_day: a.last_day,
      frequency: a.txns.size,
      monetary: round(a.monetary),
    });
  }
  void maxDay;
  return out;
}

/**
 * The 5×5 segment taxonomy. Order matters: checks run top-down and the first
 * matching rule wins, mirroring the classic Crystal-Targets matrix.
 */
export function segmentFor(r: number, f: number): RfmSegment {
  if (r >= 4 && f >= 4) return "Champions";
  if (r >= 4 && f === 3) return "Loyal";
  if (r >= 4 && f < 3) return "New Customers";
  if (r === 3 && f >= 3) return "Potential Loyalist";
  if (r === 3 && f === 2) return "Promising";
  if (r === 3 && f === 1) return "Need Attention";
  if (r === 2 && f >= 3) return "At Risk";
  if (r === 2 && f === 2) return "About To Sleep";
  if (r === 2 && f === 1) return "Hibernating";
  if (r === 1 && f >= 3) return "Cannot Lose Them";
  if (r === 1 && f === 2) return "About To Sleep";
  return "Lost";
}

export function scoreCustomers(aggregates: RfmCustomerAggregate[], maxDay: number): RfmCustomer[] {
  const recencies = aggregates.map((a) => Math.max(0, Math.round((maxDay - a.last_day) / 86_400_000)));
  const frequencies = aggregates.map((a) => a.frequency);
  const monetaries = aggregates.map((a) => a.monetary);

  return aggregates.map((a) => {
    const recencyDays = Math.max(0, Math.round((maxDay - a.last_day) / 86_400_000));
    // recency is inverted: small days → high score
    const r = ntileRank(recencies, recencyDays, 5, true);
    const f = ntileRank(frequencies, a.frequency, 5);
    const m = ntileRank(monetaries, a.monetary, 5);
    return {
      customer_id: a.customer_id,
      recency_days: recencyDays,
      frequency: a.frequency,
      monetary: a.monetary,
      r,
      f,
      m,
      segment: segmentFor(r, f),
    };
  }).sort((a, b) => b.monetary - a.monetary || a.customer_id.localeCompare(b.customer_id));
}

export function runRfm(lines: SalesLine[], referenceDate?: string | number): RfmResult {
  // Reference "now": max of the dataset (deterministic). Fall back to provided.
  let maxDay = 0;
  for (const line of lines) {
    const day = new Date(typeof line.date === "number" ? line.date : String(line.date)).getTime();
    if (!Number.isNaN(day) && day > maxDay) maxDay = day;
  }
  if (referenceDate !== undefined) {
    const ref = new Date(referenceDate).getTime();
    if (!Number.isNaN(ref) && ref > maxDay) maxDay = ref;
  }

  const aggregates = aggregateCustomers(lines, maxDay);
  const customers = scoreCustomers(aggregates, maxDay);

  const segments = new Map<RfmSegment, RfmSegmentStat>();
  for (const c of customers) {
    const stat = segments.get(c.segment) ?? {
      segment: c.segment,
      count: 0,
      share_pct: 0,
      avg_monetary: 0,
      total_monetary: 0,
    };
    stat.count += 1;
    stat.total_monetary += c.monetary;
    segments.set(c.segment, stat);
  }
  const segmentList = [...segments.values()].map((s) => ({
    ...s,
    share_pct: pctShare(s.count, customers.length) ?? 0,
    avg_monetary: round(customers.length > 0 ? s.total_monetary / s.count : 0),
  }));

  const anonymous = lines.filter((l) => (l.customer_id ?? null) === null).length;
  const flags: RfmResult["flags"] = [];
  if (anonymous === lines.length) {
    flags.push({
      level: "medium",
      message:
        "No customer identifier was found (walk-in register). RFM is computed over a synthetic \"<walk-in>\" customer — treat results as a register-level health indicator, not true repeat-purchase analytics.",
    });
  } else if (anonymous > 0) {
    flags.push({
      level: "low",
      message: `${anonymous} rows carry no customer id and were grouped under "<walk-in>".`,
    });
  }

  return {
    reference_date: new Date(maxDay).toISOString().slice(0, 10),
    customers,
    segments: segmentList,
    flags,
  };
}