"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MarkdownView } from "@/components/markdown-view";
import { RichTextView } from "@/components/rich-text-view";

export const CHART_TYPES = ["bar", "line", "area", "pie"];

// Categorical series colors — token-driven so charts adapt to light/dark.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

type SeriesPoint = { bucket?: string; value?: number | null };

function BarList({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(...series.map((s) => Number(s.value ?? 0)), 1);
  return (
    <div className="space-y-1">
      {series.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-xs text-muted">{String(s.bucket ?? "")}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-surface-subtle">
            <div
              className="h-full rounded bg-brand/70"
              style={{ width: `${Math.min(100, (Number(s.value ?? 0) / max) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">
            {s.value?.toLocaleString() ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-lg shadow-black/10">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-0.5 tabular-nums text-muted">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand align-middle" />
        {payload[0].value?.toLocaleString() ?? "—"}
      </p>
    </div>
  );
}

function ChartView({ chartType, series }: { chartType: string; series: SeriesPoint[] }) {
  const data = series.map((s, i) => ({ name: String(s.bucket ?? ""), value: Number(s.value ?? 0), fill: CHART_COLORS[i % CHART_COLORS.length] }));
  const axisTick = { fontSize: 11, fill: "var(--text-muted)" };
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {chartType !== "pie" && (
        <div className="h-4 flex-1" />
      )}
      <span className="text-xs font-medium text-muted">{chartType}</span>
    </div>
  );

  if (chartType === "pie") {
    const total = data.reduce((sum, d) => sum + d.value, 0);
    return (
      <div>
        {header}
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {data.map((d) => (
            <span key={d.name} className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
              {d.name} · {total > 0 ? Math.round((d.value / total) * 100) : 0}%
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (chartType === "line") {
    return (
      <div>
        {header}
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" interval={Math.max(0, Math.ceil(data.length / 6) - 1)} angle={-20} height={60} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === "area") {
    return (
      <div>
        {header}
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ left: 8, right: 8 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" interval={Math.max(0, Math.ceil(data.length / 6) - 1)} angle={-20} height={60} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="value" stroke="var(--brand)" fill="url(#areaFill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div>
      {header}
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="name" interval={Math.max(0, Math.ceil(data.length / 6) - 1)} angle={-20} height={60} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} animationDuration={500} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TableView({ columns, rows }: { columns: { key?: string; label?: string }[]; rows: unknown[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-subtle/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            {columns.map((c, i) => (
              <th key={`${c.key ?? i}-${i}`} className="px-3 py-2">{c.label ?? c.key ?? i}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r, i) => (
            <tr key={i} className="transition-colors hover:bg-surface-subtle/40">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground">
                  {cell == null ? "—" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportBlockBody({ body }: { body: Record<string, unknown> | null }) {
  if (!body) return <p className="text-sm text-faint">—</p>;
  const entries = Object.entries(body);
  if (entries.length === 0) return <p className="text-sm text-faint">—</p>;

  // { markdown: "…" } renders an analysis report source.
  if ("markdown" in body && typeof body.markdown === "string") {
    return <MarkdownView markdown={body.markdown} />;
  }

  // { text: "…" } renders as plain paragraphs; { text: <tiptap doc> } renders rich text.
  if ("text" in body && typeof body.text !== "undefined") {
    if (typeof body.text === "string") {
      return <p className="whitespace-pre-wrap text-sm text-foreground">{body.text}</p>;
    }
    if (typeof body.text === "object" && body.text !== null && (body.text as { type?: string }).type === "doc") {
      return <RichTextView doc={body.text as never} />;
    }
  }

  // { series: [...], metric, chart_type } renders a real chart (bar/line/area/pie)
  // when chart_type is present; otherwise falls back to a compact bar list.
  if (Array.isArray(body.series)) {
    const series = body.series as SeriesPoint[];
    const chartType = typeof body.chart_type === "string"
      ? body.chart_type
      : typeof body.chartType === "string"
        ? body.chartType
        : null;
    if (chartType && CHART_TYPES.includes(chartType) && series.length > 0) {
      return <ChartView chartType={chartType} series={series} />;
    }
    return <BarList series={series} />;
  }

  // { columns: [...], rows: [[...]] } renders as a table.
  if (Array.isArray(body.rows) && Array.isArray(body.columns)) {
    return <TableView columns={body.columns as { key?: string; label?: string }[]} rows={body.rows as unknown[][]} />;
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1">
          <dt className="text-xs text-faint">{k}</dt>
          <dd className="text-sm font-medium tabular-nums text-foreground">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}