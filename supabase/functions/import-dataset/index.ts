import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import Papa from "npm:papaparse@5.4.1";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

const MAX_ROWS = 1_000_000;
const CHUNK_SIZE = 500;
const CONCURRENCY = 8;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ColumnType = "string" | "numeric" | "date" | "boolean";

// ---- coercion (mirrors client lib/coerce.ts) ----

const TRUE_VALUES = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_VALUES = new Set(["false", "f", "no", "n", "0"]);

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function coerceValue(type: ColumnType, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  const text = toText(raw);
  if (text === null) return null;

  switch (type) {
    case "string":
      return text;
    case "numeric": {
      const trimmed = text.trim();
      if (trimmed === "") return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    case "boolean": {
      const t = text.trim().toLowerCase();
      if (TRUE_VALUES.has(t)) return true;
      if (FALSE_VALUES.has(t)) return false;
      return null;
    }
    case "date": {
      if (/^-?\d+$/.test(text.trim())) return null;
      const ts = Date.parse(text.trim());
      if (isNaN(ts)) return null;
      return new Date(ts).toISOString();
    }
    default:
      return null;
  }
}

// ---- stats (mirrors client lib/stats.ts) ----

function computeStats(
  rows: Array<{ data: Record<string, unknown> }>,
  columnDefs: Array<{ key: string; type: ColumnType }>,
): Record<string, { min: number | null; max: number | null; avg: number | null; sum: number | null; distinct_count: number; null_count: number }> {
  const out: Record<string, any> = {};
  for (const def of columnDefs) {
    const nums: number[] = [];
    const distinct = new Set<string>();
    let nulls = 0;
    for (const row of rows) {
      const v = row.data[def.key];
      if (v === null || v === undefined) { nulls += 1; continue; }
      distinct.add(JSON.stringify(v));
      if (def.type === "numeric" && typeof v === "number") nums.push(v);
    }
    let min: number | null = null;
    let max: number | null = null;
    let sum: number | null = null;
    for (const n of nums) {
      if (min === null || n < min) min = n;
      if (max === null || n > max) max = n;
      sum = (sum ?? 0) + n;
    }
    out[def.key] = {
      min,
      max,
      avg: nums.length ? (sum ?? 0) / nums.length : null,
      sum,
      distinct_count: distinct.size,
      null_count: nulls,
    };
  }
  return out;
}

// ---- parsing ----

type ParsedTable = {
  headers: string[];
  rows: unknown[][];
};

function parseCsv(buffer: Uint8Array): ParsedTable {
  const text = new TextDecoder("utf-8").decode(buffer);
  const parsed = Papa.parse<unknown[]>(text, { skipEmptyLines: true });
  const data = parsed.data;
  const headers = (data[0] ?? []).map((h) => (h === null || h === undefined ? "" : String(h)));
  const rows = data.slice(1).map((r) => (Array.isArray(r) ? r : []));
  return { headers, rows };
}

function parseXlsx(buffer: Uint8Array, sheetName: string | null): ParsedTable {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const name =
    sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const rows = raw.map((r) => (Array.isArray(r) ? r : []));
  const headers = (rows[0] ?? []).map((h) => (h === null || h === undefined ? "" : String(h)));
  return { headers, rows: rows.slice(1) };
}

function isAllEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => v === null || v === undefined);
}

// ---- inserts ----

async function clearRows(datasetId: string): Promise<void> {
  await supabase.from("dataset_rows").delete().eq("dataset_id", datasetId).throwOnError();
  await supabase.from("dataset_column_stats").delete().eq("dataset_id", datasetId).throwOnError();
}

async function chunkedInsert(datasetId: string, rows: Array<{ row_index: number; data: Record<string, unknown> }>): Promise<void> {
  const chunks: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }

  let cursor = 0;
  async function worker() {
    while (cursor < chunks.length) {
      const idx = cursor++;
      const chunk = chunks[idx].map((r) => ({
        dataset_id: datasetId,
        row_index: r.row_index,
        data: r.data,
      }));
      await supabase
        .from("dataset_rows")
        .upsert(chunk, { onConflict: "dataset_id,row_index" })
        .throwOnError();
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length || 1) }, worker);
  await Promise.all(workers);
}

async function insertStats(datasetId: string, defs: Array<{ key: string; type: ColumnType }>, stats: Record<string, any>): Promise<void> {
  const rows = defs.map((d) => {
    const s = stats[d.key];
    return {
      dataset_id: datasetId,
      column_key: d.key,
      min: s.min,
      max: s.max,
      avg: s.avg,
      sum: s.sum,
      distinct_count: s.distinct_count,
      null_count: s.null_count,
    };
  });
  if (rows.length > 0) {
    await supabase.from("dataset_column_stats").upsert(rows, { onConflict: "dataset_id,column_key" }).throwOnError();
  }
}

// ---- main ----

async function run(datasetId: string): Promise<{ status: number; body: unknown }> {
  const { data: dataset } = await supabase
    .from("datasets")
    .select("*")
    .eq("id", datasetId)
    .single();

  if (!dataset) return { status: 404, body: { error: "Dataset not found" } };

  if (dataset.status !== "pending") {
    return { status: 200, body: { skipped: true, status: dataset.status } };
  }

  const { error: claimError } = await supabase
    .from("datasets")
    .update({ status: "processing", error_message: null, updated_at: new Date().toISOString() })
    .eq("id", datasetId)
    .eq("status", "pending");

  if (claimError) return { status: 500, body: { error: claimError.message } };

  try {
    const { data: fileBuffer, error: dlError } = await supabase.storage
      .from("uploads")
      .download(dataset.storage_path);

    if (dlError || !fileBuffer) throw new Error(`Could not download file: ${dlError?.message ?? "unknown"}`);

    const buffer = new Uint8Array(await fileBuffer.arrayBuffer());
    const lowerName = dataset.original_filename.toLowerCase();
    const parsed = lowerName.endsWith(".csv")
      ? parseCsv(buffer)
      : parseXlsx(buffer, dataset.sheet_name);

    const defs: Array<{ key: string; label: string; type: ColumnType }> = dataset.column_defs ?? [];

    if (defs.length !== parsed.headers.length) {
      throw new Error("Column definition mismatch with file headers");
    }

    const dataRows: Array<{ row_index: number; data: Record<string, unknown> }> = [];
    let rowIndex = 1;
    for (const row of parsed.rows) {
      const data: Record<string, unknown> = {};
      for (let c = 0; c < defs.length; c++) {
        data[defs[c].key] = coerceValue(defs[c].type, row[c]);
      }
      if (isAllEmpty(data)) continue;
      if (rowIndex > MAX_ROWS) {
        throw new Error(`Row count exceeds the ${MAX_ROWS.toLocaleString()} limit`);
      }
      dataRows.push({ row_index: rowIndex++, data });
    }

    const stats = computeStats(dataRows, defs);

    await clearRows(datasetId);
    await chunkedInsert(datasetId, dataRows);
    await insertStats(datasetId, defs, stats);

    await supabase
      .from("datasets")
      .update({
        status: "ready",
        row_count: dataRows.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", datasetId)
      .throwOnError();

    return { status: 200, body: { ok: true, row_count: dataRows.length } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("datasets")
      .update({ status: "error", error_message: message, updated_at: new Date().toISOString() })
      .eq("id", datasetId);
    return { status: 500, body: { error: message } };
  }
}

Deno.serve(async (req: Request) => {
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get("x-supabase-webhook-secret");
    if (secret !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let datasetId: string | null = null;
  try {
    const body = await req.json();
    datasetId = body?.record?.id ?? body?.dataset_id ?? null;
    if (!datasetId) {
      return new Response(JSON.stringify({ error: "Missing dataset id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = await run(datasetId);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});