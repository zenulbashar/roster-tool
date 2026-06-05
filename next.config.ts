import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg and pg-boss are server-only; keep them out of the client bundle.
  serverExternalPackages: ["pg", "pg-boss"],
};

export default nextConfig;
