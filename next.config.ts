import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_HOST = SUPABASE_URL ? new URL(SUPABASE_URL).host : null;

// DuckDB-WASM needs Cross-Origin Isolation for its fast (SIMD + threads) COI
// bundle; otherwise it silently runs single-threaded. The CSP must permit
// wasm-unsafe-eval or the engine refuses to instantiate.
const connectSrc = ["'self'", SUPABASE_HOST ? `https://${SUPABASE_HOST} wss://${SUPABASE_HOST}` : null]
  .filter(Boolean)
  .join(" ");
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // pdfkit loads AFM font metrics from its own package dir at runtime;
  // bundling it breaks those relative reads, so keep it external.
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          // A restrictive CSP breaks dev HMR (inline/eval scripts), so only
          // ship it in production builds.
          ...(isProd
            ? [{ key: "Content-Security-Policy", value: CSP }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;