import { expect, test } from "@playwright/test";

/**
 * Plan Phase 7 — Cross-Origin Isolation check.
 *
 * DuckDB-WASM runs single-threaded (no SIMD/threads) without COI+COEP. The
 * server must emit `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp` on every response so the COI
 * bundle (`duckdb-coi.wasm` + pthread worker) instantiates. Also verifies the
 * STEP 2 asset copy is actually served.
 */

test("COOP + COEP headers on application routes", async ({ request }) => {
  for (const path of ["/", "/login", "/datasets"]) {
    const res = await request.get(path);
    expect(res.status(), `${path} should respond`).toBe(200);
    expect(res.headers()["cross-origin-opener-policy"], `${path} COOP`).toBe(
      "same-origin",
    );
    expect(res.headers()["cross-origin-embedder-policy"], `${path} COEP`).toBe(
      "require-corp",
    );
  }
});

test("CSP, when present, permits wasm + workers (production builds)", async ({
  request,
}) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"];
  if (!csp) {
    // Dev server runs without the CSP (HMR needs inline/eval). Nothing to
    // assert — production builds are covered by next.config.ts gates + CI.
    test.info().annotations.push({
      type: "info",
      description: "No CSP header in dev — expected (HMR). Skipping CSP asserts.",
    });
    return;
  }
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toMatch(/worker-src 'self' blob:/);
});

test("window.crossOriginIsolated is true", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => (window as { crossOriginIsolated?: boolean })
      .crossOriginIsolated))
    .toBe(true);
});

test("DuckDB COI bundle is served with isolation headers", async ({ request }) => {
  const asset = "/duckdb/duckdb-coi.wasm";
  const wasm = await request.get(asset);
  expect(wasm.status(), "duckdb-coi.wasm should be served").toBe(200);
  expect(wasm.headers()["content-type"]).toContain("wasm");
  expect(wasm.headers()["cross-origin-embedder-policy"]).toBe("require-corp");

  for (const worker of [
    "/duckdb/duckdb-browser-coi.worker.js",
    "/duckdb/duckdb-browser-coi.pthread.worker.js",
  ]) {
    const w = await request.get(worker);
    expect(w.status(), `${worker} should be served`).toBe(200);
  }
});