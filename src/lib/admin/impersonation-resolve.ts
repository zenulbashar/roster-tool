import { env } from "@/lib/env";
import { parseImpersonationToken } from "@/lib/admin/impersonation";

/**
 * The PURE resolution logic behind "view as venue" (M37) — separated from the
 * Next-bound plumbing (`impersonation-session.ts`) so it carries no
 * `next/headers` or Auth.js import and can be unit-tested with fake lookups.
 *
 * SECURITY MODEL — the grant is an ATTRIBUTE OF THE ADMIN'S AUTHENTICATED
 * SESSION, never a bearer token. Holding a valid cookie is necessary but not
 * sufficient: the user presenting it must ALSO be signed in as the very admin
 * the cookie is bound to. Without that binding a leaked/lingering cookie alone
 * would grant full read/write on a client's live account — including after the
 * admin signed out.
 */

export interface ActiveImpersonation {
  adminUserId: string;
  orgId: string;
  /** The entry location bound in the token (a default; the switcher can move). */
  businessId: string;
  /** The client (organisation) name — the stable banner label. */
  venueName: string;
}

/** The DB-backed checks, injectable so the resolution logic is unit-testable. */
export type ImpersonationDeps = {
  isPlatformAdmin: (userId: string) => Promise<boolean>;
  findLocationOrg: (
    businessId: string,
  ) => Promise<{ orgId: string | null; orgName: string } | null>;
};

/**
 * Resolve + fully re-validate a presented impersonation cookie for a request
 * made by `sessionUserId` (null = no signed-in user). Returns the active grant
 * or null. Every check is re-run per request (defence in depth):
 *  - HMAC signature + freshness (parseImpersonationToken),
 *  - the SIGNED-IN user is the admin the grant is bound to (no session, or a
 *    different user, → null — the cookie is not a bearer token),
 *  - that admin is STILL a platform_admin (revoking admin ends it instantly),
 *  - the bound location still belongs to the bound org.
 * The session check runs BEFORE any lookup, so a mismatched presenter never
 * touches the database.
 */
export async function resolveImpersonationFor(
  input: {
    cookieValue: string | undefined | null;
    sessionUserId: string | null;
    now?: Date;
  },
  deps: ImpersonationDeps,
): Promise<ActiveImpersonation | null> {
  const claims = parseImpersonationToken(
    input.cookieValue,
    env.AUTH_SECRET,
    input.now,
  );
  if (!claims) return null;
  if (!input.sessionUserId || input.sessionUserId !== claims.adminUserId) {
    return null;
  }
  if (!(await deps.isPlatformAdmin(claims.adminUserId))) return null;
  const loc = await deps.findLocationOrg(claims.businessId);
  if (!loc || loc.orgId !== claims.orgId) return null;
  return {
    adminUserId: claims.adminUserId,
    orgId: claims.orgId,
    businessId: claims.businessId,
    venueName: loc.orgName,
  };
}
