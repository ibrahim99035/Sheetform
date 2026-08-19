import type { ColumnRole } from "@/lib/types";

/**
 * DuckDB SQL builders that mirror the analytic projections the pure-TS
 * orchestrator (lib/analysis/modules.ts) uses. Each builder returns the SAME
 * row shapes the sibling pure functions consume, so the local (DuckDB) engine
 * can accelerate the heavy aggregations in-WASM and still funnel into the
 * identical, tested math layer.
 *
 * All builders quote identifiers defensively and take `table` as an already
 * sanitized table identifier (see lib/datastore.ts tableName()).
 */

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface SqlQuery {
  sql: string;
  /** human label used by tests / diagnostics. */
  label: string;
}

export type RoleKeys = Partial<Record<ColumnRole, string>>;

export function abcRevenueSql(table: string, productKey: string, revenueKey: string): SqlQuery {
  return {
    label: "abc-revenue",
    sql: `
      WITH product_revenue AS (
        SELECT ${ident(productKey)} AS product,
               SUM(${ident(revenueKey)}) AS revenue
        FROM ${ident(table)}
        WHERE ${ident(revenueKey)} IS NOT NULL
          AND ${ident(productKey)} IS NOT NULL
        GROUP BY ${ident(productKey)}
      ),
      ranked AS (
        SELECT product, revenue,
               SUM(revenue) OVER (ORDER BY revenue DESC, product ASC) / NULLIF(SUM(revenue) OVER (), 0) AS cumulative_share
        FROM product_revenue
      )
      SELECT product, revenue,
             ROUND(revenue / SUM(revenue) OVER () * 100, 2) AS revenue_share,
             ROUND(cumulative_share * 100, 2) AS cumulative_share,
             CASE WHEN cumulative_share <= 0.80 THEN 'A'
                  WHEN cumulative_share <= 0.95 THEN 'B'
                  ELSE 'C' END AS abc
      FROM ranked
      ORDER BY revenue DESC, product ASC`,
  };
}

export function dailyDemandSql(table: string, productKey: string, dateKey: string, qtyKey: string): SqlQuery {
  return {
    label: "daily-demand",
    sql: `
      SELECT ${ident(productKey)} AS product,
             CAST(${ident(dateKey)} AS DATE) AS day,
             MAX(ABS(COALESCE(${ident(qtyKey)}, 0))) AS units
      FROM ${ident(table)}
      WHERE ${ident(productKey)} IS NOT NULL
        AND ${ident(dateKey)} IS NOT NULL
      GROUP BY ${ident(productKey)}, CAST(${ident(dateKey)} AS DATE)
      ORDER BY ${ident(productKey)}, day ASC`,
  };
}

export function rfmAggregateSql(
  table: string,
  idKey: string,
  dateKey: string,
  amountKey: string | null,
  transactionKey: string | null,
): SqlQuery {
  const amountCol = amountKey ? `SUM(${ident(amountKey)})` : "COUNT(*) * 1.0";
  const txnCol = transactionKey
    ? `COUNT(DISTINCT ${ident(transactionKey)})`
    : "COUNT(*)";
  return {
    label: "rfm-aggregate",
    sql: `
      SELECT ${ident(idKey)} AS customer_id,
             MAX(CAST(${ident(dateKey)} AS DATE)) AS last_purchase,
             CAST(${ident(dateKey)} AS DATE) AS last_day,
             ${txnCol} AS frequency,
             ${amountCol} AS monetary
      FROM ${ident(table)}
      WHERE ${ident(idKey)} IS NOT NULL AND ${ident(dateKey)} IS NOT NULL
      GROUP BY ${ident(idKey)}
      HAVING frequency > 0`,
  };
}

export function basketPairsSql(table: string, txnKey: string, productKey: string): SqlQuery {
  return {
    label: "basket-pairs",
    sql: `
      WITH txn_products AS (
        SELECT DISTINCT ${ident(txnKey)} AS txn, ${ident(productKey)} AS product
        FROM ${ident(table)}
        WHERE ${ident(txnKey)} IS NOT NULL AND ${ident(productKey)} IS NOT NULL
      ),
      product_counts AS (
        SELECT product, COUNT(*) AS n FROM txn_products GROUP BY product
      ),
      pair_counts AS (
        SELECT a.product AS product_a, b.product AS product_b, COUNT(*) AS pairs
        FROM txn_products a
        JOIN txn_products b ON a.txn = b.txn AND a.product < b.product
        GROUP BY a.product, b.product
      ),
      totals AS (SELECT COUNT(*) AS n FROM (SELECT DISTINCT txn FROM txn_products) t)
      SELECT p.product_a, p.product_b, p.pairs,
             ROUND(p.pairs / t.n * 100, 2) AS support,
             ROUND(p.pairs / NULLIF(ca.n, 0) * 100, 2) AS confidence_a,
             ROUND(p.pairs / NULLIF(cb.n, 0) * 100, 2) AS confidence_b,
             ROUND((p.pairs / NULLIF(ca.n, 0)) / NULLIF(cb.n / t.n, 0), 2) AS lift
      FROM pair_counts p
      JOIN product_counts ca ON ca.product = p.product_a
      JOIN product_counts cb ON cb.product = p.product_b
      CROSS JOIN totals t
      ORDER BY p.pairs DESC, p.product_a ASC, p.product_b ASC
      LIMIT 20`,
  };
}

export function forecastSeriesSql(table: string, dateKey: string, valueKey: string, bucket: "day" = "day"): SqlQuery {
  const cast = bucket === "day" ? `CAST(${ident(dateKey)} AS DATE)` : bucket;
  return {
    label: "forecast-series",
    sql: `
      SELECT CAST(${cast} AS VARCHAR) AS date,
             SUM(${ident(valueKey)}) AS value
      FROM ${ident(table)}
      WHERE ${ident(valueKey)} IS NOT NULL AND ${ident(dateKey)} IS NOT NULL
      GROUP BY ${cast}
      ORDER BY date ASC`,
  };
}

export function benchmarkDailySql(
  table: string,
  dateKey: string,
  txnKey: string | null,
  productKey: string | null,
  amountKey: string | null,
  unitsKey: string | null,
  branchKey: string | null,
): SqlQuery {
  const branchCol = branchKey ? ident(branchKey) : `NULL::VARCHAR`;
  const amountCol = amountKey ? `COALESCE(${ident(amountKey)}, 0)` : "0";
  const unitsCol = unitsKey ? `COALESCE(${ident(unitsKey)}, 0)` : "0";
  const txnExpr = txnKey ? `COUNT(DISTINCT ${ident(txnKey)})` : "COUNT(*)";
  const productExpr = productKey ? `COUNT(DISTINCT ${ident(productKey)})` : "0";
  return {
    label: "benchmark-daily",
    sql: `
      SELECT ${branchCol} AS branch,
             CAST(${ident(dateKey)} AS DATE) AS day,
             ROUND(SUM(${amountCol}), 2) AS revenue,
             ROUND(SUM(${unitsCol}), 2) AS units,
             ${txnExpr} AS transactions,
             ${productExpr} AS distinct_products
      FROM ${ident(table)}
      WHERE ${ident(dateKey)} IS NOT NULL
      GROUP BY CAST(${ident(dateKey)} AS DATE), ${branchCol}
      ORDER BY day ASC`,
  };
}

export function categoryBenchmarkSql(
  table: string,
  categoryKey: string,
  amountKey: string | null,
  unitsKey: string | null,
): SqlQuery {
  const amountCol = amountKey ? `COALESCE(${ident(amountKey)}, 0)` : "0";
  const unitsCol = unitsKey ? `COALESCE(${ident(unitsKey)}, 0)` : "0";
  return {
    label: "benchmark-categories",
    sql: `
      SELECT ${ident(categoryKey)} AS category,
             ROUND(SUM(${amountCol}), 2) AS revenue,
             ROUND(SUM(${unitsCol}), 2) AS units,
             ROUND(SUM(${amountCol}) / NULLIF(SUM(SUM(${amountCol})) OVER (), 0) * 100, 2) AS share_pct
      FROM ${ident(table)}
      WHERE ${ident(categoryKey)} IS NOT NULL
      GROUP BY ${ident(categoryKey)}
      ORDER BY revenue DESC`,
  };
}

export function expiryInventorySql(table: string, expiryKey: string, stockKey: string, costKey: string | null, productKey: string): SqlQuery {
  const costCol = costKey ? `COALESCE(${ident(costKey)}, 0)` : "0";
  return {
    label: "expiry-inventory",
    sql: `
      SELECT ${ident(productKey)} AS product,
             CAST(${ident(expiryKey)} AS DATE) AS expiry_date,
             COALESCE(${ident(stockKey)}, 0) AS stock_on_hand,
             ${costCol} AS unit_cost
      FROM ${ident(table)}
      WHERE ${ident(expiryKey)} IS NOT NULL`,
  };
}