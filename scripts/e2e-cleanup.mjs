import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = {}; for (const l of readFileSync(".env.local","utf8").split("\n")) { const i=l.indexOf("="); if(i>0) env[l.slice(0,i)]=l.slice(i+1).replace(/^"|"$/g,""); }
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data: list, error } = await sb.storage.from("uploads").list("11111111-1111-4111-8111-111111111111");
console.log("list:", error ?? list?.map(f=>f.name));
for (const p of ["11111111-1111-4111-8111-111111111111/e2e-smoke/1786399222842-sample.csv"]) {
  const { error } = await sb.storage.from("uploads").remove([p]);
  console.log("remove", p, error ?? "ok");
}
