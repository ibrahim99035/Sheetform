import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = env.SUPABASE_SERVICE_ROLE_KEY;
const DATASET = "40151d11-c42e-4d7a-a357-67430d4c6f25";

const client = createClient(url, anon);
const { data: s, error: se } = await client.auth.signInWithPassword({
  email: "browser-test@siroq-e2e.test", password: "BrowserTest123!",
});
if (se) { console.log("SIGNIN ERR", se); process.exit(1); }
console.log("signed in as", s.user.email, s.user.id);

const svcClient = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: ops, error: opsErr } = await svcClient.from("dataset_operations")
  .select("*").eq("dataset_id", DATASET).order("id", { ascending: false }).limit(5);
console.log("OPS:", opsErr ? opsErr.message : ops);
const { data: ds, error: dsErr } = await svcClient.from("datasets")
  .select("id, column_defs").eq("id", DATASET);
if (dsErr) console.log("DS ERR", dsErr.message);
else console.log("DEFS now:", JSON.stringify(ds[0].column_defs.map((c) => ({ key: c.key, label: c.label }))));

const tok = (await client.auth.getSession()).data.session.access_token;
const raw = await fetch(`${url}/rest/v1/rpc/undo_operation`, {
  method: "POST",
  headers: { apikey: anon, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
  body: JSON.stringify({ p_dataset_id: DATASET }),
});
console.log("UNDO STATUS", raw.status);
console.log("UNDO BODY", raw.status === 200 ? JSON.stringify(await raw.json()) : (await raw.text()).slice(0, 600));
