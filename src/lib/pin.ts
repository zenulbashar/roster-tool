import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Staff kiosk PINs.
 *
 * PINs are short secrets typed on a shared device, so we treat them like
 * passwords: a per-PIN random salt + scrypt, stored as "scrypt$salt$hash"
 * (both base64). We compare in constant time and never store or log the PIN
 * itself.
 *
 * Brute-force protection lives here too (pure functions over the stored
 * counter + lock instant) so the kiosk can lock a staff member out after a few
 * wrong PINs. The state is persisted on the staff row by the caller, which
 * keeps the cooldown honest across server instances.
 */

const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

/** Wrong PINs allowed before a cooldown kicks in. */
export const MAX_PIN_ATTEMPTS = 5;
/** How long clock-in is locked once the limit is hit. */
export const PIN_LOCKOUT_MS = 60_000;

/** PINs are exactly four digits. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Constant-time check of a PIN against a stored "scrypt$salt$hash" string. */
export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = scryptSync(pin, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

export type LockoutState = {
  failedPinAttempts: number;
  pinLockedUntil: Date | null;
};

/** True (with remaining time) when a staff member is currently locked out. */
export function isLockedOut(
  state: LockoutState,
  now: Date = new Date(),
): { locked: boolean; retryAfterMs: number } {
  const until = state.pinLockedUntil?.getTime() ?? 0;
  const remaining = until - now.getTime();
  return remaining > 0
    ? { locked: true, retryAfterMs: remaining }
    : { locked: false, retryAfterMs: 0 };
}

/**
 * Next lockout state after a wrong PIN. Once attempts reach the limit we set a
 * cooldown and reset the counter, so the lock lifts cleanly with a fresh batch
 * of attempts rather than re-locking on the next try.
 */
export function registerFailedAttempt(
  state: LockoutState,
  now: Date = new Date(),
): LockoutState {
  const attempts = state.failedPinAttempts + 1;
  if (attempts >= MAX_PIN_ATTEMPTS) {
    return {
      failedPinAttempts: 0,
      pinLockedUntil: new Date(now.getTime() + PIN_LOCKOUT_MS),
    };
  }
  return { failedPinAttempts: attempts, pinLockedUntil: null };
}

/** State after a correct PIN: a clean slate. */
export function clearedLockout(): LockoutState {
  return { failedPinAttempts: 0, pinLockedUntil: null };
}
