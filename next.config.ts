import type { NextConfig } from "next";
import {
  SECURITY_HEADERS,
  CAPABILITY_PAGE_HEADERS,
  CAPABILITY_PAGE_SOURCES,
} from "./src/lib/security-headers";

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
  // Security headers (SEC-05) + noindex/no-referrer on the capability pages
  // (SEC-08). The sets live in src/lib/security-headers.ts and are unit-tested.
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      ...CAPABILITY_PAGE_SOURCES.map((source) => ({
        source,
        headers: CAPABILITY_PAGE_HEADERS,
      })),
    ];
  },
};

export default nextConfig;
