import { round, mean } from "./shared";

/**
 * Market-basket / co-purchase analysis at the transaction level.
 *
 * Pairs (A,B) are counted whenever a transaction contains both products.
 *   support(A,B)  = P(A ∧ B)                  (pairs / total transactions)
 *   confidence    = P(B | A)                  (pairs / transactions with A)
 *   lift          = confidence / P(B)         (>1 ⇒ relation stronger than chance)
 *
 * Deterministic; ties ordered by product name.
 */

export interface BasketOptions {
  /** maximum pair rows to return. */
  topN?: number;
  /** minimum number of transactions a pair must appear in. */
  minPairs?: number;
  /** minimum support to be considered at all (0–1). */
  minSupport?: number;
}

export interface BasketPair {
  product_a: string;
  product_b: string;
  pairs: number;
  support: number;
  confidence_a: number;
  confidence_b: number;
  lift: number;
}

export interface BasketSummary {
  transactions: number;
  distinct_products: number;
  /** avg distinct products per transaction (basket depth). */
  avg_basket_size: number;
  avg_transaction_value: number;
}

export interface BasketResult {
  pairs: BasketPair[];
  summary: BasketSummary;
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export interface BasketLine {
  transaction_id: string | null;
  product: string;
  amount?: number | null;
}

const DEFAULT_BASKET_OPTIONS: Required<BasketOptions> = {
  topN: 20,
  minPairs: 2,
  minSupport: 0,
};

/** Full transaction baskets resolved from line items. */
export function buildBaskets(lines: BasketLine[]): Map<string, string[]> {
  const baskets = new Map<string, Map<string, boolean>>();
  for (const line of lines) {
    const txn = line.transaction_id ?? "<no-txn>";
    if (line.product == null || line.product === "") continue;
    let set = baskets.get(txn);
    if (!set) {
      set = new Map();
      baskets.set(txn, set);
    }
    set.set(String(line.product), true);
  }
  const out = new Map<string, string[]>();
  for (const [txn, set] of baskets) {
    out.set(txn, [...set.keys()].sort());
  }
  return out;
}

/** Count product/A and (A,B) frequencies across transactions. */
export function countPairs(baskets: Map<string, string[]>): {
  txnCount: number;
  productCount: Map<string, number>;
  pairCount: Map<string, number>;
} {
  const productCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  let txnCount = 0;
  for (const products of baskets.values()) {
    txnCount += 1;
    for (const p of products) productCount.set(p, (productCount.get(p) ?? 0) + 1);
    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const key = `${products[i]}\u0000${products[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }
  return { txnCount, productCount, pairCount };
}

export function runBasket(lines: BasketLine[], options?: BasketOptions): BasketResult {
  const opts = { ...DEFAULT_BASKET_OPTIONS, ...options };
  const baskets = buildBaskets(lines);
  const { txnCount, productCount, pairCount } = countPairs(baskets);

  const pairs: BasketPair[] = [];
  for (const [key, pairsN] of pairCount) {
    const [a, b] = key.split("\u0000");
    const countA = productCount.get(a) ?? 0;
    const countB = productCount.get(b) ?? 0;
    const support = txnCount > 0 ? pairsN / txnCount : 0;
    if (support < opts.minSupport) continue;
    if (pairsN < opts.minPairs) continue;
    const confidenceA = countA > 0 ? pairsN / countA : 0;
    const confidenceB = countB > 0 ? pairsN / countB : 0;
    const pb = txnCount > 0 ? countB / txnCount : 0;
    const lift = pb > 0 ? confidenceA / pb : 0;
    pairs.push({
      product_a: a,
      product_b: b,
      pairs: pairsN,
      support: round(support * 100),
      confidence_a: round(confidenceA * 100),
      confidence_b: round(confidenceB * 100),
      lift: round(lift),
    });
  }

  pairs.sort((a, b) => b.pairs - a.pairs || a.product_a.localeCompare(b.product_a) || a.product_b.localeCompare(b.product_b));

  // basket depth + average ticket from the same line data
  const distinctProducts = productCount.size;
  const sizes = [...baskets.values()].map((p) => p.length);
  const avgBasketSize = mean(sizes) ?? 0;
  const totals: number[] = [];
  const byTxn = new Map<string, number>();
  for (const line of lines) {
    if (!line.amount) continue;
    byTxn.set(line.transaction_id ?? "<no-txn>", (byTxn.get(line.transaction_id ?? "<no-txn>") ?? 0) + line.amount);
  }
  for (const v of byTxn.values()) totals.push(v);

  const flags: BasketResult["flags"] = [];
  if (txnCount === 0) {
    flags.push({ level: "high", message: "No transactions resolved — basket analysis skipped." });
  } else if (txnCount < opts.minPairs) {
    flags.push({
      level: "medium",
      message: `Only ${txnCount} transactions — pair confidence is unstable below ${opts.minPairs} co-occurrences.`,
    });
  }

  return {
    pairs: pairs.slice(0, opts.topN),
    summary: {
      transactions: txnCount,
      distinct_products: distinctProducts,
      avg_basket_size: round(avgBasketSize, 2),
      avg_transaction_value: round(mean(totals) ?? 0),
    },
    flags,
  };
}