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
import type { ColumnDef, ColumnStats } from "@/lib/types";

interface AnalyzeTabProps {
  datasetId: string;
  columns: ColumnDef[];
  initialStats: ColumnStats[];
}

const NUMERIC_OPS = ["count", "sum", "avg"] as const;

export function AnalyzeTab({ datasetId, columns, initialStats }: AnalyzeTabProps) {
  const supabase = useSupabase();

  const { data: stats } = useQuery({
    queryKey: ["stats", datasetId],
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
      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">Column statistics</h3>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Distinct</th>
                <th className="px-3 py-2 text-right">Empty</th>
                <th className="px-3 py-2 text-right">Min</th>
                <th className="px-3 py-2 text-right">Max</th>
                <th className="px-3 py-2 text-right">Avg</th>
                <th className="px-3 py-2 text-right">Sum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {columns.map((col) => {
                const s = statsByColumn.get(col.key);
                const numeric = col.type === "numeric";
                return (
                  <tr key={col.key}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-neutral-900">{col.label}</span>
                      <span className="ml-2 font-mono text-xs text-neutral-400">{col.key}</span>
                    </td>
                    <td className="px-3 py-1.5 text-neutral-600">{col.type}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {s?.distinct_count ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {s?.null_count ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {numeric ? formatNumber(s?.min ?? null) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {numeric ? formatNumber(s?.max ?? null) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {numeric ? formatNumber(s?.avg ?? null) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {numeric ? formatNumber(s?.sum ?? null, 0) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Group by */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-neutral-800">Group by aggregation</h3>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4">
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Group by</span>
            <select
              value={groupCol}
              onChange={(e) => setGroupCol(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Aggregate</span>
            <select
              value={aggFn}
              onChange={(e) => setAggFn(e.target.value as (typeof NUMERIC_OPS)[number])}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            >
              {NUMERIC_OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          {aggFn !== "count" && (
            <label className="text-sm">
              <span className="mb-1 block text-neutral-500">On column</span>
              <select
                value={aggCol ?? ""}
                onChange={(e) => setAggCol(e.target.value || null)}
                className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              >
                {numericColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Top N</span>
            <input
              type="number"
              min={1}
              max={500}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value) || 10)}
              className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-500">Min groups size</span>
            <input
              type="number"
              min={1}
              value={minCount}
              onChange={(e) => setMinCount(Number(e.target.value) || 1)}
              className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
        </div>

        {groupResult.isLoading && <p className="mt-3 text-sm text-neutral-500">Computing…</p>}
        {groupResult.isError && (
          <p className="mt-3 text-sm text-red-600">{(groupResult.error as Error).message}</p>
        )}

        {chartData.length > 0 && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                  <XAxis dataKey="label" interval={0} angle={-20} height={60} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#111827" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
                    <th className="px-3 py-2">Group</th>
                    <th className="px-3 py-2 text-right">Rows</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(groupResult.data ?? []).map((r) => (
                    <tr key={r.label}>
                      <td className="max-w-[240px] truncate px-3 py-1.5 text-neutral-900">
                        {r.label === "" ? <span className="text-neutral-400">(empty)</span> : r.label}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.value === null ? "—" : formatNumber(r.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {groupResult.isSuccess && chartData.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500">No groups matched.</p>
        )}
      </section>
    </div>
  );
}