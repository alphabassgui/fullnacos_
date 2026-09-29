import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder. Otherwise Turbopack infers the root
  // from lockfiles and can pick up a stray package-lock.json in a parent
  // directory (outside this git repo), which prints a warning at startup.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
