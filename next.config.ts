import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this repository even when an ancestor has a lockfile.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
