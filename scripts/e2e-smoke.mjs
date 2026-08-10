#!/usr/bin/env node
/**
 * End-to-end smoke test of the import pipeline:
 * uploads a fixture CSV to storage, inserts a pending datasets row (which the
 * DB webhook picks up and hands to the import-dataset Edge Function), then
 * polls until the dataset reaches ready/error and prints rows + stats.
 *
 * Usage:
 *   node scripts/e2e-smoke.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}

const UID = process.env.E2E_USER_ID;
if (!UID) {
  console.error("Set E2E_USER_ID to an existing auth.users id (e.g. an owner uuid).");
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fixture = process.env.E2E_FIXTURE ?? "test/fixtures/sample.csv";
const path = `${UID}/e2e-smoke/${Date.now()}-sample.csv`;
const { error: upErr } = await supabase.storage.from("uploads").upload(path, readFileSync(fixture), {
  contentType: "text/csv",
  upsert: true,
});
if (upErr) {
  console.error("upload failed:", upErr);
  process.exit(1);
}
console.log("uploaded:", path);

const column_defs = [
  { key: "name", label: "Name", type: "string" },
  { key: "amount", label: "Amount", type: "numeric" },
  { key: "category", label: "Category", type: "string" },
  { key: "created", label: "Created", type: "date" },
  { key: "active", label: "Active", type: "boolean" },
];

const { data: ds, error: insErr } = await supabase
  .from("datasets")
  .insert({
    owner_id: UID,
    name: "E2E Smoke",
    original_filename: "sample.csv",
    storage_path: path,
    status: "pending",
    row_count: 0,
    column_defs,
    sheet_name: null,
  })
  .select()
  .single();
if (insErr) {
  console.error("insert failed:", insErr);
  process.exit(1);
}
console.log("dataset:", ds.id, "status:", ds.status);

let final;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { data: d } = await supabase.from("datasets").select("status, row_count, error_message").eq("id", ds.id).single();
  console.log(`+${(i + 1) * 2}s status=${d?.status} rows=${d?.row_count}${d?.error_message ? ` err=${d.error_message}` : ""}`);
  if (d?.status === "ready" || d?.status === "error") {
    final = d;
    break;
  }
}

const { data: rows } = await supabase
  .from("dataset_rows")
  .select("row_index, data")
  .eq("dataset_id", ds.id)
  .is("deleted_at", null)
  .order("row_index")
  .limit(3);
const { data: stats } = await supabase
  .from("dataset_column_stats")
  .select("column_key, min, max, avg, distinct_count, null_count")
  .eq("dataset_id", ds.id);
console.log("first rows:", JSON.stringify(rows, null, 1));
console.log("stats:", JSON.stringify(stats, null, 1));

if (final?.status !== "ready") process.exit(1);
