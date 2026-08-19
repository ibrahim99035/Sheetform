import { round, sum } from "./shared";

/**
 * Deterministic time-series forecasting for pharmacy demand/revenue.
 *
 * Two methods, chosen by holdout MAPE:
 *  - SMA(m): simple moving average (recursive for the horizon).
 *  - Holt-Winters: additive-trend × multiplicative-weekly-seasonality triple
 *    exponential smoothing, parameters found by a fixed grid search.
 *
 * The reference "now" is the last point of the input series (reproducible), and
 * holdout validation uses the final `holdout` points — never a random split.
 */

export interface ForecastPoint {
  date: string;
  value: number;
}

export interface ForecastOptions {
  horizon?: number; // default 14 (days)
  season?: number; // default 7 (weekly)
  holdout?: number; // default 7 (points held out for MAPE)
  method?: "auto" | "sma" | "holt-winters";
}

export type ForecastMethod = "sma" | "holt-winters" | "naive";

export interface ForecastResult {
  method: ForecastMethod;
  params: Record<string, number>;
  history: ForecastPoint[];
  fitted: (ForecastPoint & { model: number })[];
  forecast: ForecastPoint[];
  mape: number | null;
  benchmark_mape: number | null;
  flags: { level: "high" | "medium" | "low"; message: string }[];
}

export function toDailySeries(points: ForecastPoint[]): number[] {
  if (points.length === 0) return [];
  const days = new Map<string, number>();
  for (const p of points) {
    const key = p.date.slice(0, 10);
    days.set(key, (days.get(key) ?? 0) + (Number.isFinite(p.value) ? p.value : 0));
  }
  const keys = [...days.keys()].sort();
  const start = Date.parse(keys[0]);
  const end = Date.parse(keys[keys.length - 1]);
  const out: number[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    out.push(days.get(key) ?? 0);
  }
  return out;
}

export function dailyDatesFrom(series: number[], startDate: string): string[] {
  const start = Date.parse(startDate.slice(0, 10));
  return series.map((_, i) => {
    const d = new Date(start + i * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });
}

/** Simple moving average: next value = mean of the last m (recursive ahead). */
export function smaForecast(series: number[], m: number, horizon: number): number[] {
  const out: number[] = [];
  const buf = [...series];
  for (let h = 0; h < horizon; h++) {
    const window = buf.slice(Math.max(0, buf.length - m));
    const next = sum(window) / window.length;
    out.push(next);
    buf.push(next);
  }
  return out;
}

/**
 * Holt-Winters (additive trend, multiplicative seasonality). Returns
 * fitted values (same length as `series`) and the future forecast.
 */
export function holtWinters(
  series: number[],
  season: number,
  horizon: number,
  alpha: number,
  beta: number,
  gamma: number,
): { fitted: number[]; forecast: number[] } {
  const n = series.length;
  if (n < season * 2 + 2) {
    return { fitted: [], forecast: smaForecast(series, Math.max(1, Math.floor(season)), horizon) };
  }
  const level0 = sum(series.slice(0, season)) / season;
  const trend0 = (series[season] - series[0]) / season;
  const seasonal0 = series.slice(0, season).map((v) => (level0 > 0 ? v / level0 : 1));

  let level = level0;
  let trend = trend0;
  const seasonal: number[] = [];
  for (let s = -season; s < Math.max(season, n); s++) {
    const idx = ((s % season) + season) % season;
    seasonal.push(seasonal0[idx] ?? 1);
  }

const fitted: number[] = [];
  for (let i = 0; i < n; i++) {
    const sIdx = i + season;
    const prevSeason = seasonal[sIdx];
    const fit = (level + trend) * prevSeason;
    fitted.push(fit);
    const y = series[i];
    const prevLevel = level;
    level = alpha * (y / Math.max(prevSeason, 1e-9)) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[sIdx + season] = gamma * (y / Math.max(level, 1e-9)) + (1 - gamma) * prevSeason;
  }

  const forecast: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const sIdx = n + season + h - 1;
    forecast.push((level + h * trend) * (seasonal[sIdx] ?? 1));
  }
  return { fitted, forecast };
}

/** MAPE in % over held-out points; null when every actual is zero. */
export function mape(actual: number[], predicted: number[]): number | null {
  let err = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === 0) continue;
    err += Math.abs((actual[i] - predicted[i]) / actual[i]);
    n += 1;
  }
  return n === 0 ? null : round((err / n) * 100);
}

/** Naive benchmark: next = last observed (persistence). */
export function naiveForecast(series: number[], horizon: number): number[] {
  const last = series[series.length - 1] ?? 0;
  return Array.from({ length: horizon }, () => last);
}

export function runForecast(
  points: ForecastPoint[],
  options?: ForecastOptions,
): ForecastResult {
  const horizon = options?.horizon ?? 14;
  const season = options?.season ?? 7;
  const holdout = options?.holdout ?? 7;
  const method = options?.method ?? "auto";

  const series = toDailySeries(points);
  const dates = dailyDatesFrom(series, points[0]?.date ?? new Date().toISOString());
  const flags: ForecastResult["flags"] = [];

  if (series.length < Math.max(season + 2, 6)) {
    flags.push({ level: "high", message: `Only ${series.length} daily points — forecasts are unreliable below ~${season + 2} days.` });
  }

  const train = series.slice(0, Math.max(1, series.length - holdout));
  const test = series.slice(Math.max(1, series.length - holdout));
  const modelLen = train.length;

  const candidates: { method: ForecastMethod; params: Record<string, number>; mape: number | null; forecast: number[] }[] = [];

  const naivePred = naiveForecast(train, test.length);
  const naiveMape = mape(test, naivePred);
  candidates.push({ method: "naive", params: {}, mape: naiveMape, forecast: naivePred });

  if (method === "auto" || method === "sma") {
    for (const m of [3, 5, 7, 14]) {
      if (modelLen < m) continue;
      const pred = smaForecast(train, m, test.length);
      candidates.push({ method: "sma", params: { m }, mape: mape(test, pred), forecast: pred });
    }
  }

  if (method === "auto" || method === "holt-winters") {
    for (const alpha of [0.2, 0.4, 0.6]) {
      for (const beta of [0.1, 0.2, 0.3]) {
        for (const gamma of [0.1, 0.3, 0.5]) {
          if (modelLen < season * 2 + 2) continue;
          const { forecast: pred } = holtWinters(train, season, test.length, alpha, beta, gamma);
          if (pred.length === test.length) {
            candidates.push({ method: "holt-winters", params: { alpha, beta, gamma, season }, mape: mape(test, pred), forecast: pred });
          }
        }
      }
    }
  }

  const best = candidates
    .map((c) => ({ ...c, score: c.mape === null ? Infinity : c.mape }))
    .sort((a, b) => a.score - b.score)[0];

  const chosenMethod = best?.method ?? "naive";
  const chosenParams = best?.params ?? {};

  // Build the full fitted + n-step-ahead forecast with the chosen params.
  let fittedFull: number[] = [];
  let forecastValues: number[] = [];
  if (chosenMethod === "holt-winters" && series.length >= season * 2 + 2) {
    const hw = holtWinters(series, chosenParams.season ?? season, horizon, chosenParams.alpha ?? 0.4, chosenParams.beta ?? 0.2, chosenParams.gamma ?? 0.3);
    fittedFull = hw.fitted;
    forecastValues = hw.forecast;
  } else if (chosenMethod === "sma") {
    fittedFull = series.map(() => 0);
    forecastValues = smaForecast(series, chosenParams.m ?? 7, horizon);
  } else {
    forecastValues = naiveForecast(series, horizon);
  }

  const fitted = fittedFull.map((model, i) => ({ date: dates[i], value: series[i], model: round(model) }));
  const forecast = forecastValues.map((value, i) => {
    const lastDate = Date.parse(dates[dates.length - 1]);
    const d = new Date(lastDate + (i + 1) * 86_400_000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return { date, value: round(Math.max(0, value)) };
  });
  const history = series.map((value, i) => ({ date: dates[i], value: round(value) }));

  if (best && best.mape === null) {
    flags.push({ level: "low", message: "MAPE is undefined — the holdout window contains only zero demand." });
  }
  if (best && best.method !== "holt-winters" && series.length >= season * 2 + 2) {
    flags.push({ level: "low", message: "Holt-Winters did not beat SMA/naive on the holdout — the series is too flat or too noisy for seasonality." });
  }

  return {
    method: chosenMethod,
    params: chosenParams,
    history,
    fitted,
    forecast,
    mape: best?.mape ?? null,
    benchmark_mape: naiveMape,
    flags,
  };
}