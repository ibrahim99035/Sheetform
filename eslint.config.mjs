import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno Edge Functions — linted by the Supabase CLI/Deno toolchain instead.
    "supabase/functions/**",
    // DuckDB-WASM bundles copied to public (scripts/copy-duckdb-assets.mjs)
    // are minified third-party assets — not project source.
    "public/duckdb/**",
  ]),
]);

export default eslintConfig;
