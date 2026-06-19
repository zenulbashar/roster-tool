import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg and pg-boss are server-only; keep them out of the client bundle.
  serverExternalPackages: ["pg", "pg-boss"],
  experimental: {
    // The staff-document upload server action streams files up to 10 MB; the
    // default server-action body limit is 1 MB. Leave headroom for the
    // multipart envelope.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
