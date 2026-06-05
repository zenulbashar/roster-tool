import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Scoped, single-use-ish tokens for staff magic links.
 *
 * We generate a high-entropy random token, hand the raw token to the user (in
 * their email link), and store ONLY its SHA-256 hash. To authenticate an
 * incoming link we hash the presented token and look it up. The raw token is
 * never persisted or logged.
 */

const TOKEN_BYTES = 32; // 256 bits of entropy

export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Unguessable slug for the public read-only roster URL. Not a secret in the
 * token sense, but long enough that the link can't be guessed.
 */
export function generateSlug(): string {
  return randomBytes(12).toString("base64url");
}

/** Constant-time comparison of two hex hashes of equal length. */
export function safeHashEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
