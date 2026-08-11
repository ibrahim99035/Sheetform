#!/usr/bin/env node
/**
 * Applies new supabase/migrations/*.sql files to the remote project via the
 * Supabase Management API query endpoint — no database password required.
 *
 * Applied file names are tracked in public._applied_migrations so files are
 * only ever run once. 20260810180000_init.sql is pre-seeded as applied,
 * because it was pushed before tracking existed.
 *
 * Usage:
 *   node scripts/push-migrations.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REF = process.env.SUPABASE_PROJECT_REF ?? "vhgkjxdwptirmyqjhiks";

function getToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const path = join(homedir(), ".supabase", "access-token");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  throw new Error("No access token found. Run `npx supabase login` or set SUPABASE_ACCESS_TOKEN.");
}

const token = getToken();
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const endpoint = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function run(query) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status}: ${body}`);
  }
  return body;
}

// Bootstrap the tracking table and pre-seed the migration that predates it.
await run(`create table if not exists public._applied_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);`);
await run(`insert into public._applied_migrations (name)
  select '20260810180000_init.sql'
  where not exists (select 1 from public._applied_migrations);`);

const applied = new Set(JSON.parse(await run(
  `select name from public._applied_migrations`,
)).map((r) => r.name));

const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const pending = files.filter((f) => !applied.has(f));
console.log(`Applied: ${applied.size} | Pending: ${pending.length}`);
if (pending.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

for (const file of pending) {
  const query = readFileSync(migrationsDir + file, "utf8");
  process.stdout.write(`— ${file} … `);
  await run(query);
  await run(`insert into public._applied_migrations (name) values ('${file.replace(/'/g, "''")}');`);
  console.log("ok");
}

console.log("Migrations applied.");