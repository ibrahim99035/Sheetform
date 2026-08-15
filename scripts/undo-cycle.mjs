import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const DSID = "40151d11-c42e-4d7a-a357-67430d4c6f25";

const client = createClient(url, anon);
await client.auth.signInWithPassword({
  email: "browser-test@siroq-e2e.test",
  password: "BrowserTest123!",
});
const tok = (await client.auth.getSession()).data.session.access_token;

const rpc = async (fn, body, label) => {
  const t = Date.now();
  const raw = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t;
  const text = await raw.text();
  let out = text;
  try { out = JSON.stringify(JSON.parse(text)); } catch {}
  console.log(`${label}: ${ms}ms [${raw.status}] ${out.slice(0, 300)}`);
  return { status: raw.status, body: JSON.parse(text) };
};

const colKeys = async () => {
  const raw = await fetch(`${url}/rest/v1/datasets?select=column_defs&id=eq.${DSID}`, {
    headers: { apikey: anon, Authorization: `Bearer ${tok}` },
  });
  const rows = await raw.json();
  return (rows[0]?.column_defs || []).map((c) => c.key);
};

const opsTail = async () => {
  const raw = await fetch(
    `${url}/rest/v1/dataset_operations?select=id,operation_type,undone_at,applied_at&dataset_id=eq.${DSID}&order=id.desc&limit=4`,
    { headers: { apikey: anon, Authorization: `Bearer ${tok}` } }
  );
  return await raw.json();
};

console.log("keys before:", await colKeys());
console.log("ops tail before:", JSON.stringify(await opsTail()));

const r1 = await rpc("apply_operation", {
  p_dataset_id: DSID,
  p_operation: "rename_column",
  p_params: { old_key: "numeric", new_key: "numeric_value", new_label: "Numeric value" },
}, "apply rename numeric->numeric_value");
if (r1.status !== 200) process.exit(1);
console.log("keys after apply:", await colKeys());

const r2 = await rpc("undo_operation", { p_dataset_id: DSID }, "undo");
if (r2.status !== 200) process.exit(1);
console.log("keys after undo:", await colKeys());

const r3 = await rpc("redo_operation", { p_dataset_id: DSID }, "redo");
if (r3.status !== 200) process.exit(1);
console.log("keys after redo:", await colKeys());

const r4 = await rpc("undo_operation", { p_dataset_id: DSID }, "undo again");
if (r4.status !== 200) process.exit(1);
console.log("keys after undo#2:", await colKeys());

console.log("ops tail after:", JSON.stringify(await opsTail()));
