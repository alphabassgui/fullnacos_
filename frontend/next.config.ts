import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ['audience-demote-siren.ngrok-free.dev'],
  async rewrites() {
    // Use the same env var the client reads; strip trailing slashes so the
    // destination URL is clean. Falls back to localhost for local dev.
    const backendUrl = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000").replace(/\/+$/, "");
    return [
      {
        source: '/api/backend/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;