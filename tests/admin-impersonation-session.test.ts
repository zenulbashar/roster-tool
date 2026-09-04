import { describe, it, expect } from "vitest";
import { env } from "@/lib/env";
import {
  makeImpersonationToken,
  IMPERSONATION_TTL_MS,
  type ImpersonationClaims,
} from "@/lib/admin/impersonation";
import {
  resolveImpersonationFor,
  type ImpersonationDeps,
} from "@/lib/admin/impersonation-resolve";

/**
 * SEC-01 regression guard. The impersonation cookie is NOT a bearer token: it
 * resolves only when presented by a session belonging to the admin it was
 * minted for. These tests drive the pure resolution logic with fake DB lookups.
 */

const ADMIN = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "99999999-9999-9999-9999-999999999999";
const ORG = "22222222-2222-2222-2222-222222222222";
const BIZ = "33333333-3333-3333-3333-333333333333";

const claims: ImpersonationClaims = {
  adminUserId: ADMIN,
  orgId: ORG,
  businessId: BIZ,
};

function deps(overrides: Partial<ImpersonationDeps> = {}): ImpersonationDeps {
  return {
    isPlatformAdmin: async (id) => id === ADMIN,
    findLocationOrg: async (id) =>
      id === BIZ ? { orgId: ORG, orgName: "Bondi Cafe" } : null,
    ...overrides,
  };
}

describe("resolveImpersonationFor (SEC-01: session-bound grant)", () => {
  const now = new Date("2026-08-01T10:00:00Z");
  const cookie = makeImpersonationToken(claims, env.AUTH_SECRET, now);

  it("resolves for the bound admin's own session", async () => {
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: ADMIN, now },
      deps(),
    );
    expect(res).toEqual({
      adminUserId: ADMIN,
      orgId: ORG,
      businessId: BIZ,
      venueName: "Bondi Cafe",
    });
  });

  it("REJECTS a valid cookie presented with NO session (not a bearer token)", async () => {
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: null, now },
      deps(),
    );
    expect(res).toBeNull();
  });

  it("REJECTS a valid cookie presented by a DIFFERENT signed-in user", async () => {
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: OTHER_USER, now },
      deps(),
    );
    expect(res).toBeNull();
  });

  it("does not consult the database when the session does not match", async () => {
    let dbTouched = false;
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: OTHER_USER, now },
      deps({
        isPlatformAdmin: async () => {
          dbTouched = true;
          return true;
        },
        findLocationOrg: async () => {
          dbTouched = true;
          return { orgId: ORG, orgName: "x" };
        },
      }),
    );
    expect(res).toBeNull();
    expect(dbTouched).toBe(false);
  });

  it("rejects when the admin has since been revoked", async () => {
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: ADMIN, now },
      deps({ isPlatformAdmin: async () => false }),
    );
    expect(res).toBeNull();
  });

  it("rejects when the bound location no longer belongs to the bound org", async () => {
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: ADMIN, now },
      deps({
        findLocationOrg: async () => ({
          orgId: "44444444-4444-4444-4444-444444444444",
          orgName: "Moved",
        }),
      }),
    );
    expect(res).toBeNull();
  });

  it("rejects an expired cookie even for the right session", async () => {
    const later = new Date(now.getTime() + IMPERSONATION_TTL_MS + 1);
    const res = await resolveImpersonationFor(
      { cookieValue: cookie, sessionUserId: ADMIN, now: later },
      deps(),
    );
    expect(res).toBeNull();
  });

  it("rejects an absent cookie", async () => {
    expect(
      await resolveImpersonationFor(
        { cookieValue: undefined, sessionUserId: ADMIN, now },
        deps(),
      ),
    ).toBeNull();
  });

  it("uses a short TTL (a support interaction, not a shift)", () => {
    expect(IMPERSONATION_TTL_MS).toBe(30 * 60 * 1000);
  });
});
