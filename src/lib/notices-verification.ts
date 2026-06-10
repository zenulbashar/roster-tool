import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived proof that a staff member entered their PIN on /me.
 *
 * The /me capability link identifies WHO; the PIN proves it's them. Unlike the
 * kiosk's one-PIN-per-action model, a notices PAGE needs that proof to survive
 * the post-PIN render, refreshes and mark-read actions — so after a correct
 * PIN we set a second httpOnly cookie holding `staffId.expiryMs.hmac`, signed
 * with AUTH_SECRET. It expires after 15 minutes (re-enter the PIN), is bound
 * to ONE staff member, and is verified on every render/action. NOT a
 * persistent session: nothing is stored server-side and it can't be refreshed
 * without the PIN.
 */

export const NOTICES_VERIFICATION_TTL_MS = 15 * 60 * 1000;

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Make the cookie value proving `staffMemberId` PIN-verified until `expiresAtMs`. */
export function makeNoticesVerification(
  staffMemberId: string,
  secret: string,
  now: Date = new Date(),
): string {
  const expiresAtMs = now.getTime() + NOTICES_VERIFICATION_TTL_MS;
  const payload = `${staffMemberId}.${expiresAtMs}`;
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/**
 * Check a presented cookie value: intact signature, not expired, and bound to
 * the SAME staff member the capability token resolved to.
 */
export function checkNoticesVerification(
  value: string | undefined,
  staffMemberId: string,
  secret: string,
  now: Date = new Date(),
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [id, expiry, mac] = parts as [string, string, string];
  if (id !== staffMemberId) return false;
  const expiresAtMs = Number(expiry);
  if (!Number.isFinite(expiresAtMs) || now.getTime() >= expiresAtMs)
    return false;
  const expected = signature(`${id}.${expiry}`, secret);
  let presented: Buffer;
  try {
    presented = Buffer.from(mac, "base64url");
  } catch {
    return false;
  }
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
