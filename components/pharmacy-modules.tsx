"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { runPharmacyAnalysis } from "@/lib/actions/pharmacy";
import { buildSuite } from "@/lib/analysis/modules";
import {
  getBenchmarkOptIn,
  setBenchmarkOptIn,
  syncBenchmarkAggregates,
  type BenchmarkOptInState,
} from "@/lib/actions/benchmark";
import type {
  PharmacySuite,
  RfmModuleResult,
  BasketModuleResult,
  ForecastModuleResult,
  BenchmarkModuleResult,
  SalesLensModuleResult,
  SupplierModuleResult,
  GeographyModuleResult,
  BudgetModuleResult,
  StocktakeModuleResult,
  ModuleState,
} from "@/lib/analysis/modules";
import type { AbcXyzResult } from "@/lib/analysis/abc-xyz";
import type { SafetyStockResult } from "@/lib/analysis/safety-stock";
import type { ExpiryResult } from "@/lib/analysis/expiry";
import type { SalesRankRow } from "@/lib/analysis/sales";
import type { ColumnDef } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CloudUpload, Sparkles } from "lucide-react";

interface PharmacyModulesProps {
  datasetId: string;
  columns: ColumnDef[];
  /** Local-first rows (OPFS snapshot). When provided, the analysis suite runs
   *  fully in the browser on the current local data; otherwise it runs through
   *  the server action against cloud rows. */
  localRows?: Record<string, unknown>[] | null;
}

/**
 * Deterministic pharmacy BI modules. Computed fully on-device / server-side
 * from the dataset rows (no AI): customer RFM + market basket, ABC-XYZ +
 * safety stock, expiry risk, demand/revenue forecast, and opt-in benchmark
 * aggregates.
 */
export function PharmacyModules({ datasetId, columns, localRows }: PharmacyModulesProps) {
  const [suite, setSuite] = useState<PharmacySuite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const useLocal = Array.isArray(localRows);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        if (useLocal) {
          setSuite(buildSuite(columns, localRows, { benchmarkRegion: null }));
          return;
        }
        const res = await runPharmacyAnalysis(datasetId);
        if (res.ok) setSuite(res.suite);
        else setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      }
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Pharmacy analytics</h3>
          <p className="mt-0.5 text-sm text-muted">
            Deterministic modules computed from this dataset — no AI involved. Runs once on request.
          </p>
        </div>
        <Button size="sm" onClick={run} disabled={isPending}>
          <Sparkles className="h-3.5 w-3.5" />
          {isPending ? "Analyzing…" : suite ? "Re-run analysis" : "Run analysis"}
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}

      {isPending && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-40 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {suite && !isPending && <SuiteBody suite={suite} datasetId={datasetId} />}
    </section>
  );
}

function Unavailable({ state }: { state: { available: false; reason: string } }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-faint">{state.reason}</p>
      </CardContent>
    </Card>
  );
}

function SuiteBody({ suite, datasetId }: { suite: PharmacySuite; datasetId: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SalesCard state={suite.modules.sales} />
      <SupplierCard state={suite.modules.supplier} />
      <GeographyCard state={suite.modules.geography} />
      <BudgetCard state={suite.modules.budget} />
      <StocktakeCard state={suite.modules.stocktake} />
      <RfmCard state={suite.modules.rfm} />
      <BasketCard state={suite.modules.basket} />
      <AbcCard state={suite.modules.abcXyz} />
      <SafetyCard state={suite.modules.safetyStock} />
      <ExpiryCard state={suite.modules.expiry} />
      <ForecastCard state={suite.modules.forecast} />
      <BenchmarkCard state={suite.modules.benchmark} datasetId={datasetId} runKey={suite.generatedAt} />
    </div>
  );
}

function SalesCard({ state }: { state: ModuleState<SalesLensModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { sales } = state.result;
  const t = sales.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales lens</CardTitle>
        <CardDescription className="mt-0.5">
          Revenue, units, tickets and mix · refund rate {t.refund_pct ?? 0}%
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-4 gap-3 text-center">
          <Stat label="Revenue" value={t.revenue.toLocaleString()} />
          <Stat label="Units" value={t.units.toLocaleString()} />
          <Stat label="Avg ticket" value={t.avg_ticket?.toLocaleString() ?? "—"} />
          <Stat label="Avg basket" value={t.avg_basket_units?.toLocaleString() ?? "—"} />
        </div>
        {sales.byRep && sales.byRep.length > 0 && (
          <MiniRank title="By sales rep" rows={sales.byRep.slice(0, 4)} />
        )}
        {sales.byTeam && sales.byTeam.length > 0 && (
          <MiniRank title="By team" rows={sales.byTeam.slice(0, 4)} />
        )}
        <p className="mt-3 text-xs text-faint">
          {sales.monthly.slice(-3).map((m) => `${m.period} ${m.revenue.toLocaleString()}`).join(" · ")}
        </p>
      </CardContent>
    </Card>
  );
}

function SupplierCard({ state }: { state: ModuleState<SupplierModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { suppliers } = state.result;
  const c = suppliers.concentration;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Supplier lens</CardTitle>
        <CardDescription className="mt-0.5">
          Spend {suppliers.totals.spend.toLocaleString()} · {suppliers.totals.suppliers} suppliers · top-3 {c.top3_share_pct ?? 0}%
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Supplier</th>
              <th className="px-4 py-2.5 text-right">Spend</th>
              <th className="px-4 py-2.5 text-right">Share</th>
              <th className="px-4 py-2.5 text-right">Orders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {suppliers.suppliers.slice(0, 6).map((s) => (
              <tr key={s.label}>
                <td className="max-w-[200px] truncate px-4 py-2 font-medium text-foreground">{s.label}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.spend.toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.share_pct ?? 0}%</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function GeographyCard({ state }: { state: ModuleState<GeographyModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { geography } = state.result;
  const top = geography.cities.length > 0 ? geography.cities : geography.regions.length > 0 ? geography.regions : geography.countries;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Geography lens</CardTitle>
        <CardDescription className="mt-0.5">
          {geography.totals.customers} customers · {geography.totals.revenue.toLocaleString()} revenue ·{" "}
          {geography.markers.length > 0 ? `${geography.markers.length} map markers` : "no coordinates yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <MiniRank title={geography.cities.length > 0 ? "By city" : geography.regions.length > 0 ? "By region" : "By country"} rows={top.slice(0, 5)} />
      </CardContent>
    </Card>
  );
}

function BudgetCard({ state }: { state: ModuleState<BudgetModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { budget } = state.result;
  const t = budget.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget vs actual</CardTitle>
        <CardDescription className="mt-0.5">
          Attainment {t.attainment_pct ?? 0}% · variance {t.variance > 0 ? "+" : ""}
          {t.variance.toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Period / Category</th>
              <th className="px-4 py-2.5 text-right">Budget</th>
              <th className="px-4 py-2.5 text-right">Actual</th>
              <th className="px-4 py-2.5 text-right">Attain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {budget.rows.slice(0, 6).map((r) => (
              <tr key={`${r.period}-${r.category ?? ""}`}>
                <td className="max-w-[200px] truncate px-4 py-2 font-medium text-foreground">
                  {r.period} {r.category ? `· ${r.category}` : ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.budget.toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.actual.toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.attainment_pct ?? 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function StocktakeCard({ state }: { state: ModuleState<StocktakeModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { stocktake } = state.result;
  const t = stocktake.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock count audit</CardTitle>
        <CardDescription className="mt-0.5">
          {t.mismatch_lines} of {stocktake.rows.length} lines differ · total variance {t.variance_units > 0 ? "+" : ""}
          {t.variance_units.toLocaleString()} units
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5 text-right">System</th>
              <th className="px-4 py-2.5 text-right">Counted</th>
              <th className="px-4 py-2.5 text-right">Δ</th>
              <th className="px-4 py-2.5 text-right">Adj value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {stocktake.adjusted.slice(0, 5).map((r) => (
              <tr key={`${r.product}-${r.batch ?? ""}`}>
                <td className="max-w-[180px] truncate px-4 py-2 font-medium text-foreground">{r.product}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.system_qty}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.counted_qty}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.variance > 0 ? "+" : ""}{r.variance}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.adjustment_value?.toLocaleString() ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stocktake.adjusted.length === 0 && (
          <p className="px-4 py-2 text-xs text-faint">No adjustments — counts match the system.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle/50 p-2">
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function MiniRank({ title, rows }: { title: string; rows: SalesRankRow[] }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="mt-1 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-sm">
            <span className="w-full max-w-[160px] truncate text-foreground">{r.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted">{r.value.toLocaleString()}</span>
            <span className="w-8 shrink-0 text-right tabular-nums text-faint">{r.share_pct ?? 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RfmCard({ state }: { state: ModuleState<RfmModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { segmentation } = state.result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer RFM</CardTitle>
        <CardDescription className="mt-0.5">
          Recency · frequency · monetary quintiles, reference {segmentation.reference_date}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Segment</th>
              <th className="px-4 py-2.5 text-right">Customers</th>
              <th className="px-4 py-2.5 text-right">Share</th>
              <th className="px-4 py-2.5 text-right">Avg ₩</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {segmentation.segments.map((s) => (
              <tr key={s.segment}>
                <td className="px-4 py-2 font-medium text-foreground">{s.segment}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.count}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.share_pct}%</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.avg_monetary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-faint">
          {segmentation.customers.length} scored customers ·{" "}
          {segmentation.flags.map((f) => f.message).join(" · ") || "no data-quality flags"}
        </p>
      </CardContent>
    </Card>
  );
}

function BasketCard({ state }: { state: ModuleState<BasketModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { marketBasket } = state.result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market basket</CardTitle>
        <CardDescription className="mt-0.5">
          Co-purchase pairs · {marketBasket.summary.transactions} transactions,{" "}
          {marketBasket.summary.distinct_products} products
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Pair</th>
              <th className="px-4 py-2.5 text-right">Co-occur</th>
              <th className="px-4 py-2.5 text-right">Support</th>
              <th className="px-4 py-2.5 text-right">Confidence</th>
              <th className="px-4 py-2.5 text-right">Lift</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {marketBasket.pairs.slice(0, 8).map((p) => (
              <tr key={`${p.product_a}\u0000${p.product_b}`}>
                <td className="max-w-[220px] truncate px-4 py-2 font-medium text-foreground">
                  {p.product_a} + {p.product_b}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p.pairs}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.support}%</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.confidence_a}%</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.lift}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-faint">
          avg basket size {marketBasket.summary.avg_basket_size} · avg ticket {marketBasket.summary.avg_transaction_value}
        </p>
      </CardContent>
    </Card>
  );
}

function AbcCard({ state }: { state: ModuleState<AbcXyzResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { matrix, thresholds } = state.result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>ABC-XYZ matrix</CardTitle>
        <CardDescription className="mt-0.5">
          Revenue share × demand stability — replenishment policy
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          {matrix.map((c) => (
            <div
              key={c.cell}
              className="rounded-lg border border-border bg-surface-subtle/50 p-2"
              title={c.count > 0 ? undefined : "no products"}
            >
              <div className="mb-1 flex items-center justify-between font-semibold text-foreground">
                <span>{c.cell}</span>
                <span className="tabular-nums text-faint">{c.count}</span>
              </div>
              <ul className="max-h-20 space-y-0.5 overflow-y-auto text-muted">
                {c.products.slice(0, 4).map((p) => (
                  <li key={p} className="truncate">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">
          ABC: A ≤ {thresholds.aShare * 100}% cumulative revenue · B ≤ {thresholds.bShare * 100}% · XYZ by daily-demand CV
        </p>
      </CardContent>
    </Card>
  );
}

function SafetyCard({ state }: { state: ModuleState<SafetyStockResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { items } = state.result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Safety stock</CardTitle>
        <CardDescription className="mt-0.5">
          Reorder points at {state.result.params.serviceLevel}% service level, {state.result.params.leadTimeDays}-day lead time
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5 text-right">Avg/day</th>
              <th className="px-4 py-2.5 text-right">σ</th>
              <th className="px-4 py-2.5 text-right">Safety</th>
              <th className="px-4 py-2.5 text-right">Reorder</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.slice(0, 8).map((i) => (
              <tr key={i.product}>
                <td className="max-w-[200px] truncate px-4 py-2 font-medium text-foreground">{i.product}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.avg_daily_demand}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.demand_stddev}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.safety_stock}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.reorder_point}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ExpiryCard({ state }: { state: ModuleState<ExpiryResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { buckets, at_risk_units, at_risk_exposure, total_stock_value } = state.result;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Expiry risk</CardTitle>
        <CardDescription className="mt-0.5">
          Exposure {at_risk_exposure.toLocaleString()} of {total_stock_value.toLocaleString()} · {at_risk_units} at-risk units
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Window</th>
              <th className="px-4 py-2.5 text-right">Lines</th>
              <th className="px-4 py-2.5 text-right">Units</th>
              <th className="px-4 py-2.5 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {buckets.map((b) => (
              <tr key={b.bucket}>
                <td className="px-4 py-2 font-medium text-foreground">{b.bucket}</td>
                <td className="px-4 py-2 text-right tabular-nums">{b.count}</td>
                <td className="px-4 py-2 text-right tabular-nums">{b.units}</td>
                <td className="px-4 py-2 text-right tabular-nums">{b.financial_exposure.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ForecastCard({ state }: { state: ModuleState<ForecastModuleResult> }) {
  if (!state.available) return <Unavailable state={state} />;
  const { forecast } = state.result;
  const rows = [...forecast.history, ...forecast.forecast];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Demand forecast</CardTitle>
        <CardDescription className="mt-0.5">
          {forecast.method} model · {forecast.forecast.length}-day horizon · holdout MAPE {forecast.mape ?? "—"}%
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex h-28 items-end gap-[2px]">
          {rows.map((r, i) => {
            const isForecast = i >= forecast.history.length;
            return (
              <div
                key={`${r.date}-${i}`}
                className={isForecast ? "bg-brand" : "bg-brand/35"}
                style={{ height: `${Math.max(2, (r.value / max) * 100)}%`, minWidth: 3 }}
                title={`${r.date}: ${r.value}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-brand/35" /> history
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-brand" /> forecast
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function BenchmarkCard({
  state,
  datasetId,
  runKey,
}: {
  state: ModuleState<BenchmarkModuleResult>;
  datasetId: string;
  runKey: string;
}) {
  if (!state.available) return <Unavailable state={state} />;
  return <BenchmarkCardBody state={state} datasetId={datasetId} runKey={runKey} />;
}

function BenchmarkCardBody({
  state,
  datasetId,
  runKey,
}: {
  state: ModuleState<BenchmarkModuleResult> & { available: true };
  datasetId: string;
  runKey: string;
}) {
  const { daily, categories, patient_count, hashed_patients } = state.result;
  const totalRevenue = daily.reduce((a, d) => a + d.revenue, 0);
  const totalUnits = daily.reduce((a, d) => a + d.units, 0);
  const days = daily.length;

  const [optIn, setOptIn] = useState<BenchmarkOptInState | null>(null);
  const [region, setRegion] = useState("");
  const [optInError, setOptInError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    { status: "idle" | "syncing" | "done" | "skipped" | "error"; message?: string } | null
  >(null);
  const [isSavingOptIn, startSave] = useTransition();
  const [isSyncing, startSync] = useTransition();

  const optedInRef = useRef(false);
  const lastRunKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    getBenchmarkOptIn(datasetId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setOptIn(res.state);
        optedInRef.current = res.state.enabled;
        setRegion(res.state.region ?? res.state.orgRegion ?? "");
      } else {
        setOptInError(res.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [datasetId]);

  const runSync = () => {
    startSync(async () => {
      setSyncStatus({ status: "syncing" });
      const res = await syncBenchmarkAggregates(datasetId);
      if (res.ok) {
        setSyncStatus(
          res.skipped
            ? { status: "skipped", message: res.reason }
            : { status: "done", message: `Synced ${res.synced} aggregates to market benchmarks.` },
        );
      } else {
        setSyncStatus({ status: "error", message: res.error });
      }
    });
  };

  // Auto-sync once per run when the tenant has opted in.
  useEffect(() => {
    if (!runKey || runKey === lastRunKeyRef.current) return;
    lastRunKeyRef.current = runKey;
    if (!optedInRef.current) return;
    startSync(async () => {
      setSyncStatus({ status: "syncing" });
      const res = await syncBenchmarkAggregates(datasetId);
      if (res.ok) {
        setSyncStatus(
          res.skipped
            ? { status: "skipped", message: res.reason }
            : { status: "done", message: `Auto-synced ${res.synced} aggregates.` },
        );
      } else {
        setSyncStatus({ status: "error", message: res.error });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const persistOptIn = (enabled: boolean, nextRegion: string) => {
    setOptInError(null);
    optedInRef.current = enabled;
    startSave(async () => {
      const res = await setBenchmarkOptIn(datasetId, { enabled, region: nextRegion.trim() || null });
      if (res.ok) {
        setOptIn((prev) => (prev ? { ...prev, enabled, region: nextRegion.trim() || null } : prev));
      } else {
        setOptInError(res.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benchmark snapshot</CardTitle>
        <CardDescription className="mt-0.5">
          Opt-in aggregates · {days} branch-day rows ·{" "}
          {hashed_patients ? `${patient_count} patients (hashed)` : "no patient column (aggregates only)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border border-border bg-surface-subtle/50 p-3">
            <p className="text-xl font-semibold tabular-nums text-foreground">{totalRevenue.toLocaleString()}</p>
            <p className="text-xs text-muted">Revenue</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-subtle/50 p-3">
            <p className="text-xl font-semibold tabular-nums text-foreground">{totalUnits.toLocaleString()}</p>
            <p className="text-xs text-muted">Units</p>
          </div>
          <div className="rounded-lg border border-border bg-surface-subtle/50 p-3">
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {daily.length > 0 ? Math.round((totalRevenue / days) * 100) / 100 : 0}
            </p>
            <p className="text-xs text-muted">Avg daily</p>
          </div>
        </div>
        {categories.length > 0 && (
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-subtle">
            {categories.map((c) => (
              <div key={c.category} className="bg-brand/60" style={{ width: `${c.share_pct ?? 0}%` }} title={`${c.category} ${c.share_pct}%`} />
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-faint">
          {categories.slice(0, 4).map((c) => `${c.category} ${c.share_pct}%`).join(" · ")}
        </p>

        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={optIn?.enabled ?? false}
              disabled={isSavingOptIn}
              onChange={(e) => persistOptIn(e.target.checked, region)}
            />
            <span className="text-foreground">Share anonymous benchmark aggregates</span>
          </label>
          <p className="text-xs text-faint">
            Uploads daily/category totals only — kilobytes, no rows and no patient data (SHA-256 hashed when a
            patient column exists).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Benchmark region"
              placeholder="Region (e.g. Cairo)"
              value={region}
              className="h-8 w-44"
              disabled={isSavingOptIn}
              onChange={(e) => setRegion(e.target.value)}
              onBlur={() => {
                if (optIn?.enabled && region.trim() !== (optIn.region ?? "")) {
                  persistOptIn(true, region);
                }
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={runSync}
              disabled={isSyncing || isSavingOptIn || !optIn?.enabled}
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {isSyncing || syncStatus?.status === "syncing" ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          {optInError && <p className="text-xs text-danger-text">{optInError}</p>}
          {syncStatus?.message && (
            <p className="text-xs text-faint">
              {syncStatus.status === "done" && "✓ "}
              {syncStatus.status === "skipped" && "— "}
              {syncStatus.status === "error" && "✗ "}
              {syncStatus.message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
