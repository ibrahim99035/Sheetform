// Copies @duckdb/duckdb-wasm browser bundles (wasm + worker scripts) into
// public/duckdb/ so Next.js (Turbopack/webpack-agnostic) can serve them at
// fixed paths — `?url` asset imports are webpack-only and unreliable there.
//
// Usage: node scripts/copy-duckdb-assets.mjs  (also wired into "postinstall")
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "node_modules", "@duckdb", "duckdb-wasm", "dist");
const dest = join(root, "public", "duckdb");

// esm extensionless worker scripts import each other via bare specifiers on
// some browsers; the plain "-browser-*" builds are self-contained IIFEs.
const NEEDED = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-eh.wasm",
  "duckdb-browser-eh.worker.js",
  "duckdb-coi.wasm",
  "duckdb-browser-coi.worker.js",
  "duckdb-browser-coi.pthread.worker.js",
];

if (!existsSync(dist)) {
  console.error(`[@duckdb/duckdb-wasm] not found at ${dist}`);
  console.error("Run `npm install` first.");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

let copied = 0;
for (const name of NEEDED) {
  const src = join(dist, name);
  if (!existsSync(src)) {
    console.warn(`[copy-duckdb-assets] MISSING expected asset: ${name}`);
    continue;
  }
  copyFileSync(src, join(dest, name));
  copied += 1;
}

// Extra .map files in dist play no runtime role; skip them, but surface if the
// bundle set changes so the file list above can be kept in sync.
const extra = readdirSync(dist).filter((f) => f.startsWith("duckdb-") && !f.endsWith(".map"));
for (const f of extra) {
  if (!NEEDED.some((n) => n === f)) {
    console.warn(`[copy-duckdb-assets] dist has ${f} not in NEEDED — review.`);
  }
}

console.log(`[copy-duckdb-assets] copied ${copied}/${NEEDED.length} assets to public/duckdb`);