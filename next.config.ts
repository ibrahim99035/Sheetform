import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit loads AFM font metrics from its own package dir at runtime;
  // bundling it breaks those relative reads, so keep it external.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
