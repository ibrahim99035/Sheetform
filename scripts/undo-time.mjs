import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const client = createClient(url, anon);
await client.auth.signInWithPassword({ email: "browser-test@siroq-e2e.test", password: "BrowserTest123!" });
const tok = (await client.auth.getSession()).data.session.access_token;
// report the session default via the invoker diag
let raw = await fetch(`${url}/rest/v1/rpc/_diag_timeout`, {
  method: "POST",
  headers: { apikey: anon, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
console.log("diag_timeout:", JSON.stringify(await raw.json()));
// sleep 12s
const t = Date.now();
raw = await fetch(`${url}/rest/v1/rpc/_diag_sleep`, {
  method: "POST",
  headers: { apikey: anon, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
  body: JSON.stringify({ seconds: 12 }),
});
console.log(`_diag_sleep(12): ${Date.now() - t}ms [${raw.status}]`, raw.status === 200 ? await raw.text() : (await raw.text()).slice(0, 200));
