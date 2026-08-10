#!/usr/bin/env node
/**
 * Creates the Database Webhook (as a SQL trigger on public.datasets INSERT)
 * that invokes the import-dataset Edge Function via supabase_functions.http_request.
 *
 * The trigger posts the row payload to the function endpoint with the anon key
 * as the Authorization bearer (the function has verify_jwt disabled and guards
 * itself with the WEBHOOK_SECRET header instead).
 *
 * Reads project URL + anon key + WEBHOOK_SECRET from .env.local (creates the
 * secret and appends it there if missing). Requires the CLI management access
 * token via SUPABASE_ACCESS_TOKEN or ~/.supabase/access-token.
 *
 * Usage:
 *   node scripts/create-webhook.mjs
 */
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const REF = process.env.SUPABASE_PROJECT_REF ?? "vhgkjxdwptirmyqjhiks";

function getToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const path = join(homedir(), ".supabase", "access-token");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  throw new Error("No access token found. Run `npx supabase login` or set SUPABASE_ACCESS_TOKEN.");
}

function loadEnv() {
  const env = {};
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error(".env.local is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

let webhookSecret = env.WEBHOOK_SECRET;
if (!webhookSecret) {
  webhookSecret = randomBytes(24).toString("hex");
  appendFileSync(".env.local", `\nWEBHOOK_SECRET=${webhookSecret}\n`);
  console.log("Generated WEBHOOK_SECRET and appended to .env.local");
}

const trigger = `drop trigger if exists on_dataset_insert_import on public.datasets;
create trigger on_dataset_insert_import
after insert on public.datasets
for each row
execute function supabase_functions.http_request(
  '${URL}/functions/v1/import-dataset',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer ${ANON}","x-supabase-webhook-secret":"${webhookSecret}","User-Agent":"supabase-webhook-1.0"}',
  '{}',
  '60000'
);`;

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: trigger }),
});

if (!res.ok) {
  console.error("Failed to create webhook:", res.status, await res.text());
  process.exit(1);
}

console.log(`Created trigger on_dataset_insert_import for ${URL}/functions/v1/import-dataset (id: ${randomUUID().slice(0, 8)})`);
