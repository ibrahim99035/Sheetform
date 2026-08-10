#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to the remote project via the Supabase
 * Management API query endpoint — no database password required.
 *
 * Usage:
 *   node scripts/push-migrations.mjs
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
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

const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

console.log(`Applying ${files.length} migration(s) to ${REF}…`);

for (const file of files) {
  const query = readFileSync(migrationsDir + file, "utf8");
  process.stdout.write(`— ${file} … `);
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`FAILED (${res.status})\n${body}`);
    process.exit(1);
  }
  console.log("ok");
}

console.log("Migrations applied.");