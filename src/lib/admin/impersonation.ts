import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, short-lived proof that a Zale IT admin is impersonating ("viewing
 * as") a specific tenant location (M37).
 *
 * The admin console lets an admin operate inside a live tenant to support them.
 * That capability rides in an httpOnly cookie holding
 * `adminUserId.orgId.businessId.expiryMs.hmac`, signed with AUTH_SECRET. It is:
 *  - bound to ONE admin + ONE org + ONE location,
 *  - short-lived (re-enter from the console after it expires),
 *  - re-verified on every owner request (see resolveImpersonation), which ALSO
 *    re-checks the admin is still a `platform_admin` and the location still
 *    belongs to the org — so a revoked admin or moved location can't keep
 *    acting.
 *
 * NOT a session: nothing is stored server-side and it cannot be refreshed
 * without going back through the console. Mirrors the HMAC proof pattern in
 * src/lib/notices-verification.ts.
 */

export const IMPERSONATION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const IMPERSONATION_COOKIE = "roster_impersonation";

export interface ImpersonationClaims {
  adminUserId: string;
  orgId: string;
  businessId: string;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Build the cookie value granting `claims` until now + TTL. */
export function makeImpersonationToken(
  claims: ImpersonationClaims,
  secret: string,
  now: Date = new Date(),
): string {
  const expiresAtMs = now.getTime() + IMPERSONATION_TTL_MS;
  const payload = `${claims.adminUserId}.${claims.orgId}.${claims.businessId}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/**
 * Verify a presented cookie value: intact signature and not expired. Returns the
 * bound claims, or null if missing/malformed/tampered/expired. The caller MUST
 * still re-check the admin + location against the DB (this only proves the
 * cookie was minted by us and is fresh).
 */
export function parseImpersonationToken(
  value: string | undefined | null,
  secret: string,
  now: Date = new Date(),
): ImpersonationClaims | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [adminUserId, orgId, businessId, expiry, mac] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!adminUserId || !orgId || !businessId) return null;
  const expiresAtMs = Number(expiry);
  if (!Number.isFinite(expiresAtMs) || now.getTime() >= expiresAtMs)
    return null;
  const expected = signature(
    `${adminUserId}.${orgId}.${businessId}.${expiry}`,
    secret,
  );
  let presented: Buffer;
  try {
    presented = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;
  return { adminUserId, orgId, businessId };
}
