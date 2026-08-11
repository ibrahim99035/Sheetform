"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSupabase } from "@/lib/supabase/provider";
import { fetchGroupBy } from "@/lib/dataset-api";
import { formatNumber } from "@/lib/view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ColumnDef, ColumnStats } from "@/lib/types";

interface AnalyzeTabProps {
  datasetId: string;
  columns: ColumnDef[];
  initialStats: ColumnStats[];
}

const NUMERIC_OPS = ["count", "sum", "avg"] as const;

const TYPE_DOT: Record<string, string> = {
  string: "bg-info",
  numeric: "bg-brand",
  date: "bg-warning",
  boolean: "bg-success",
};

export function AnalyzeTab({ datasetId, columns, initialStats }: AnalyzeTabProps) {
  const supabase = useSupabase();

  const { data: stats } = useQuery({
    queryKey: ["stats", datasetId],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dataset_column_stats")
        .select("*")
        .eq("dataset_id", datasetId);
      if (error) throw new Error(error.message);
      return (data ?? []) as ColumnStats[];
    },
    initialData: initialStats,
  });

  const statsByColumn = useMemo(() => {
    const map = new Map<string, ColumnStats>();
    for (const s of stats ?? []) map.set(s.column_key, s);
    return map;
  }, [stats]);

  const numericColumns = columns.filter((c) => c.type === "numeric");
  const [groupCol, setGroupCol] = useState(numericColumns[0]?.key ?? columns[0]?.key ?? "");
  const [aggCol, setAggCol] = useState<string | null>(numericColumns[0]?.key ?? null);
  const [aggFn, setAggFn] = useState<(typeof NUMERIC_OPS)[number]>("count");
  const [topN, setTopN] = useState(10);
  const [minCount, setMinCount] = useState(1);

  const groupResult = useQuery({
    queryKey: ["groupby", datasetId, groupCol, aggCol, aggFn, topN, minCount],
    queryFn: () =>
      fetchGroupBy(supabase, datasetId, {
        group: groupCol,
        agg: aggFn === "count" ? null : aggCol,
        fn: aggFn,
        topN,
        minCount,
      }),
    enabled: groupCol !== "",
  });

  const chartData = useMemo(
    () =>
      (groupResult.data ?? []).map((r) => ({
        label: r.label === "" ? "(empty)" : r.label,
        value: r.value ?? r.count,
      })),
    [groupResult.data],
  );

  return (
    <div className="space-y-6">
      {/* Column stats */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Column statistics</CardTitle>
            <CardDescription className="mt-0.5">
              A quick profile of every column in the dataset.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Column</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5 text-right">Distinct</th>
                <th className="px-4 py-2.5 text-right">Empty</th>
                <th className="px-4 py-2.5 text-right">Min</th>
                <th className="px-4 py-2.5 text-right">Max</th>
                <th className="px-4 py-2.5 text-right">Avg</th>
                <th className="px-4 py-2.5 text-right">Sum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {columns.map((col) => {
                const s = statsByColumn.get(col.key);
                const numeric = col.type === "numeric";
                return (
                  <tr key={col.key} className="transition-colors hover:bg-surface-subtle/40">
                    <td className="px-4 py-2">
                      <span className="font-medium text-foreground">{col.label}</span>
                      <span className="ml-2 font-mono text-xs text-faint">{col.key}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5 text-muted">
                        <span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT[col.type] ?? "bg-faint"}`} />
                        {col.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {s?.distinct_count ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {s?.null_count ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {numeric ? formatNumber(s?.min ?? null) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {numeric ? formatNumber(s?.max ?? null) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {numeric ? formatNumber(s?.avg ?? null) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {numeric ? formatNumber(s?.sum ?? null, 0) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Group by */}
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">Group by aggregation</h3>
          <p className="mt-0.5 text-sm text-muted">
            Split the data by a column and chart a count, sum, or average.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-start gap-x-4 gap-y-4 p-4">
            <div className="w-full space-y-1.5 sm:w-44">
              <Label htmlFor="group-col">Group by</Label>
              <Select
                id="group-col"
                value={groupCol}
                onChange={(e) => setGroupCol(e.target.value)}
              >
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full space-y-1.5 sm:w-44">
              <Label htmlFor="agg-fn">Aggregate</Label>
              <Select
                id="agg-fn"
                value={aggFn}
                onChange={(e) => setAggFn(e.target.value as (typeof NUMERIC_OPS)[number])}
              >
                {NUMERIC_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
            {aggFn !== "count" && (
              <div className="w-full space-y-1.5 sm:w-44">
                <Label htmlFor="agg-col">On column</Label>
                <Select
                  id="agg-col"
                  value={aggCol ?? ""}
                  onChange={(e) => setAggCol(e.target.value || null)}
                >
                  {numericColumns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="w-full space-y-1.5 sm:w-32">
              <Label htmlFor="top-n">Top N</Label>
              <Input
                id="top-n"
                type="number"
                min={1}
                max={500}
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value) || 10)}
              />
            </div>
            <div className="w-full space-y-1.5 sm:w-40">
              <Label htmlFor="min-count">Min group size</Label>
              <Input
                id="min-count"
                type="number"
                min={1}
                value={minCount}
                onChange={(e) => setMinCount(Number(e.target.value) || 1)}
              />
            </div>
          </CardContent>
        </Card>

        {groupResult.isLoading && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <Skeleton className="h-[320px] w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {groupResult.isError && (
          <p className="mt-3 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {(groupResult.error as Error).message}
          </p>
        )}

        {!groupResult.isLoading && !groupResult.isError && chartData.length > 0 && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                    <defs>
                      <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand)" stopOpacity={1} />
                        <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.45} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      interval={Math.max(0, Math.ceil(chartData.length / 6) - 1)}
                      angle={-20}
                      height={60}
                      tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip cursor={{ fill: "var(--surface-subtle)" }} content={<ChartTooltip />} />
                    <Bar dataKey="value" fill="url(#barFill)" radius={[4, 4, 0, 0]} animationDuration={500} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5">Group</th>
                      <th className="px-4 py-2.5 text-right">Rows</th>
                      <th className="px-4 py-2.5 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {(groupResult.data ?? []).map((r) => (
                      <tr key={r.label} className="transition-colors hover:bg-surface-subtle/40">
                        <td className="max-w-[240px] truncate px-4 py-2 font-medium text-foreground">
                          {r.label === "" ? (
                            <span className="text-faint">(empty)</span>
                          ) : (
                            r.label
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {r.count}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {r.value === null ? "—" : formatNumber(r.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}
        {groupResult.isSuccess && chartData.length === 0 && (
          <p className="mt-3 text-sm text-muted">No groups matched.</p>
        )}
      </section>
    </div>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number }[];
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-lg shadow-black/10">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-0.5 tabular-nums text-muted">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand align-middle" />
        {payload[0].name}:{" "}
        <span className="font-semibold text-foreground">
          {formatNumber(payload[0].value ?? null)}
        </span>
      </p>
    </div>
  );
}
