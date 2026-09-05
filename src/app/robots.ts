import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW } from "@/lib/security-headers";

/**
 * Only the marketing landing page is for crawlers. Every capability page
 * (public roster, public form, availability link, kiosk, clock-in, notices)
 * relies on an unguessable URL, so it must never be indexed (SEC-08); the
 * signed-in areas simply aren't public.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] }],
  };
}
