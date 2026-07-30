import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Standalone output: ~150 MB image vs ~1 GB. Required for slim prod docker.
  output: "standalone",
  // Monorepo: trace from the repo root (../..) so workspace deps are included.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // Transpile workspace packages so Turbopack handles their `.js` ESM
  // re-exports correctly (the source is `.ts`, NodeNext-style suffixed).
  transpilePackages: ["@voiceplatform/shared"],
};

export default nextConfig;
