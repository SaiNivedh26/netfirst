import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  cacheComponents: true,
  partialPrefetching: true,
  // Production routes /api and /analytics at the load balancer; these only matter when the web app serves them directly.
  async rewrites() {
    const target = process.env.ANALYTICS_URL ?? "http://localhost:3001"
    const api = process.env.API_URL ?? "http://localhost:8000"
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/analytics", destination: `${target}/analytics` },
      { source: "/analytics/:path*", destination: `${target}/analytics/:path*` },
    ]
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
