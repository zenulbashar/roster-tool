import { describe, it, expect } from "vitest";
import {
  SECURITY_HEADERS,
  CAPABILITY_PAGE_HEADERS,
  CAPABILITY_PAGE_SOURCES,
  CONTENT_SECURITY_POLICY,
  ROBOTS_DISALLOW,
} from "@/lib/security-headers";

/**
 * SEC-05 / SEC-08 regression guard: the header set next.config.ts serves is
 * pure data here, so it is asserted directly — the app previously shipped
 * with NO security headers at all.
 */
function header(name: string, set = SECURITY_HEADERS): string {
  const h = set.find((x) => x.key.toLowerCase() === name.toLowerCase());
  if (!h) throw new Error(`missing header ${name}`);
  return h.value;
}

describe("security headers (every route)", () => {
  it("serves HSTS with preload, nosniff, frame denial, referrer and permissions policies", () => {
    expect(header("Strict-Transport-Security")).toMatch(/max-age=\d{8,}/);
    expect(header("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(header("Strict-Transport-Security")).toContain("preload");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const pp = header("Permissions-Policy");
    // Genuinely needed, same-origin only: kiosk photos + GPS clock-in.
    expect(pp).toContain("camera=(self)");
    expect(pp).toContain("geolocation=(self)");
    expect(pp).toContain("microphone=()");
    expect(pp).toContain("payment=()");
  });

  it("ships a CSP in report-only mode that denies framing and objects", () => {
    expect(header("Content-Security-Policy-Report-Only")).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
    // The one third-party script the app loads.
    expect(CONTENT_SECURITY_POLICY).toContain("challenges.cloudflare.com");
    // Not enforced yet — never silently promote without triaging reports.
    expect(
      SECURITY_HEADERS.some((h) => h.key === "Content-Security-Policy"),
    ).toBe(false);
  });
});

describe("capability pages (public roster, forms, availability, kiosk, clock, notices)", () => {
  it("are never indexed and never leak their URL via Referer", () => {
    expect(header("X-Robots-Tag", CAPABILITY_PAGE_HEADERS)).toContain(
      "noindex",
    );
    expect(header("X-Robots-Tag", CAPABILITY_PAGE_HEADERS)).toContain(
      "nofollow",
    );
    expect(header("Referrer-Policy", CAPABILITY_PAGE_HEADERS)).toBe(
      "no-referrer",
    );
  });

  it("cover every capability route prefix", () => {
    for (const prefix of ["/r/", "/f/", "/a/", "/me/", "/kiosk/", "/clock/"]) {
      expect(
        CAPABILITY_PAGE_SOURCES.some((s) => s.startsWith(prefix)),
        `no header source for ${prefix}`,
      ).toBe(true);
    }
  });

  it("robots.txt disallows every non-marketing surface", () => {
    for (const p of [
      "/app",
      "/admin",
      "/api",
      "/r",
      "/f",
      "/a",
      "/me",
      "/kiosk",
      "/clock",
    ]) {
      expect(ROBOTS_DISALLOW).toContain(p);
    }
  });
});
