import { describe, it, expect } from "vitest";
import {
  makeImpersonationToken,
  parseImpersonationToken,
  IMPERSONATION_TTL_MS,
  type ImpersonationClaims,
} from "@/lib/admin/impersonation";

const SECRET = "test-secret-abc";
const claims: ImpersonationClaims = {
  adminUserId: "11111111-1111-1111-1111-111111111111",
  orgId: "22222222-2222-2222-2222-222222222222",
  businessId: "33333333-3333-3333-3333-333333333333",
};

describe("impersonation token", () => {
  it("round-trips valid claims", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    const token = makeImpersonationToken(claims, SECRET, now);
    expect(parseImpersonationToken(token, SECRET, now)).toEqual(claims);
  });

  it("rejects a token signed with a different secret", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    const token = makeImpersonationToken(claims, SECRET, now);
    expect(parseImpersonationToken(token, "other-secret", now)).toBeNull();
  });

  it("rejects an expired token", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    const token = makeImpersonationToken(claims, SECRET, now);
    const later = new Date(now.getTime() + IMPERSONATION_TTL_MS + 1);
    expect(parseImpersonationToken(token, SECRET, later)).toBeNull();
    // Still valid one ms before expiry.
    const justBefore = new Date(now.getTime() + IMPERSONATION_TTL_MS - 1);
    expect(parseImpersonationToken(token, SECRET, justBefore)).toEqual(claims);
  });

  it("rejects tampered claims (bound fields are signed)", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    const token = makeImpersonationToken(claims, SECRET, now);
    const parts = token.split(".");
    // Swap the businessId part for another id; signature no longer matches.
    parts[2] = "44444444-4444-4444-4444-444444444444";
    expect(parseImpersonationToken(parts.join("."), SECRET, now)).toBeNull();
  });

  it("rejects malformed values", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    expect(parseImpersonationToken(undefined, SECRET, now)).toBeNull();
    expect(parseImpersonationToken("", SECRET, now)).toBeNull();
    expect(parseImpersonationToken("a.b.c", SECRET, now)).toBeNull();
    expect(parseImpersonationToken("a.b.c.d.e.f", SECRET, now)).toBeNull();
  });
});
