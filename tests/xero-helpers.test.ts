import { describe, expect, it } from "vitest";
import {
  buildXeroAuthUrl,
  emailFromIdToken,
  isTokenExpired,
  scopesIncludePayrun,
  toXeroMsDate,
  XERO_SCOPE_STRING,
  XERO_SCOPES,
} from "@/lib/xero/tokens";

/** Pure Xero helper coverage — no DB, no network. The boundary-relevant bits
 * (scope never includes pay-runs; auth URL is well-formed) are asserted here. */

describe("xero token/scope helpers", () => {
  it("requests read/timesheet scopes and NEVER a pay-run scope", () => {
    expect(XERO_SCOPES).toContain("payroll.timesheets");
    expect(XERO_SCOPES).toContain("payroll.employees.read");
    expect(XERO_SCOPES).toContain("payroll.settings.read");
    expect(XERO_SCOPES).toContain("offline_access");
    expect(XERO_SCOPES).toContain("openid");
    expect(XERO_SCOPES).toContain("email");
    // The whole boundary in one assertion:
    expect(scopesIncludePayrun(XERO_SCOPE_STRING)).toBe(false);
    expect(XERO_SCOPE_STRING).not.toMatch(/payrun/i);
  });

  it("scopesIncludePayrun catches every pay-run variant", () => {
    expect(scopesIncludePayrun("payroll.payruns")).toBe(true);
    expect(scopesIncludePayrun("payroll.payruns.read")).toBe(true);
    expect(scopesIncludePayrun("openid payroll.payruns offline_access")).toBe(
      true,
    );
    expect(scopesIncludePayrun("PAYROLL.PAYRUNS")).toBe(true);
    expect(
      scopesIncludePayrun("payroll.timesheets payroll.employees.read"),
    ).toBe(false);
  });

  it("isTokenExpired refreshes early within the skew window", () => {
    const now = new Date("2026-07-08T00:00:00.000Z");
    expect(isTokenExpired(new Date("2026-07-08T01:00:00.000Z"), now)).toBe(
      false,
    );
    expect(isTokenExpired(new Date("2026-07-08T00:00:30.000Z"), now)).toBe(
      true,
    ); // within 60s skew
    expect(isTokenExpired(new Date("2026-07-07T23:59:00.000Z"), now)).toBe(
      true,
    );
  });

  it("buildXeroAuthUrl is well-formed and carries no pay-run scope", () => {
    const url = new URL(
      buildXeroAuthUrl({
        clientId: "cid",
        redirectUri: "https://roster.example/api/integrations/xero/callback",
        state: "nonce-123",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.xero.com/identity/connect/authorize",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("state")).toBe("nonce-123");
    expect(url.searchParams.get("scope")).toBe(XERO_SCOPE_STRING);
    expect(url.searchParams.get("scope")).not.toMatch(/payrun/i);
  });

  it("emailFromIdToken reads the email claim, else empty", () => {
    const payload = Buffer.from(
      JSON.stringify({ email: "book@keeper.test", sub: "x" }),
    ).toString("base64url");
    const jwt = `header.${payload}.sig`;
    expect(emailFromIdToken(jwt)).toBe("book@keeper.test");
    expect(emailFromIdToken(undefined)).toBe("");
    expect(emailFromIdToken("")).toBe("");
    expect(emailFromIdToken("not-a-jwt")).toBe("");
    const noEmail = Buffer.from(JSON.stringify({ sub: "x" })).toString(
      "base64url",
    );
    expect(emailFromIdToken(`h.${noEmail}.s`)).toBe("");
  });

  it("toXeroMsDate emits Xero's MS-JSON date format", () => {
    const ms = Date.parse("2026-07-08T00:00:00.000Z");
    expect(toXeroMsDate("2026-07-08")).toBe(`/Date(${ms})/`);
    expect(() => toXeroMsDate("not-a-date")).toThrow();
  });
});
