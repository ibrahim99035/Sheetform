import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const DATASET = "40151d11-c42e-4d7a-a357-67430d4c6f25";
// mark leftover ops undone so history is clean (they are no-ops w.r.t. current column state)
const { data, error } = await c.from("dataset_operations")
  .update({ undone_at: new Date().toISOString() })
  .eq("dataset_id", DATASET).is("undone_at", null);
console.log("mark undone:", error?.message ?? "ok");
const { data: defs } = await c.from("datasets").select("column_defs").eq("id", DATASET).single();
console.log("column keys:", JSON.stringify(defs.column_defs.map((c) => c.key)));
