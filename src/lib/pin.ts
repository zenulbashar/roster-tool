import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Staff kiosk PINs.
 *
 * PINs are short secrets typed on a shared device, so we treat them like
 * passwords: a per-PIN random salt + scrypt, stored as "scrypt$salt$hash"
 * (both base64). We compare in constant time and never store or log the PIN
 * itself.
 *
 * Brute-force protection lives here too (pure functions over the stored
 * counter + lock instant) so every PIN surface locks a staff member out after
 * a few wrong PINs. The state is persisted on the staff row by the caller,
 * which keeps the cooldown honest across server instances.
 *
 * SEC-06 hardening:
 *  - The lockout ESCALATES (1 min → 5 → 15 → 60) on a CUMULATIVE failure
 *    counter that is reset only by a correct PIN. The old ladder reset the
 *    counter on every lock, so the sustainable attack rate was a flat 5 PINs a
 *    minute forever — ~16 h to an expected hit on a 4-digit space.
 *  - New PINs may be 4–6 digits and must not be trivially guessable
 *    (`isValidNewPin`); existing 4-digit PINs keep working.
 *  - Verification is ASYNC (SEC-07): the synchronous scrypt blocked the whole
 *    event loop for ~50–100 ms per attempt, serialising a busy kiosk and
 *    handing an attacker CPU amplification.
 *  - The per-DEVICE rate limit that closes the venue-wide lockout DoS lives in
 *    `src/lib/pin-auth.ts` (it needs the database).
 */

const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Wrong PINs allowed before a cooldown kicks in (per batch). */
export const MAX_PIN_ATTEMPTS = 5;

/**
 * Cooldown after each successive batch of MAX_PIN_ATTEMPTS failures. The
 * counter is cumulative (reset only by a correct PIN), so the second batch
 * waits 5 minutes, the third 15, then an hour per batch thereafter.
 */
export const PIN_LOCKOUT_LADDER_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
] as const;

/** The FIRST cooldown (kept for callers/tests that reference the base step). */
export const PIN_LOCKOUT_MS = PIN_LOCKOUT_LADDER_MS[0];

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/** Any PIN a staff member might ENTER: 4–6 digits. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/**
 * The most-guessed short PINs (repeats, runs, years and keypad patterns).
 * Rejected for NEW PINs only — an existing PIN is never invalidated.
 */
const WEAK_PINS = new Set([
  "1234",
  "4321",
  "0123",
  "3210",
  "1212",
  "2121",
  "1010",
  "0101",
  "2580",
  "0852",
  "1004",
  "2000",
  "2001",
  "2020",
  "1998",
  "1999",
  "6969",
  "4200",
  "123456",
  "654321",
  "121212",
  "112233",
  "111222",
  "159753",
  "123123",
  "000000",
]);

function isSameDigit(pin: string): boolean {
  return /^(\d)\1+$/.test(pin);
}

/** "1234", "9876", "2345"… — consecutive ascending or descending digits. */
function isSequential(pin: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i++) {
    const d = Number(pin[i]) - Number(pin[i - 1]);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  return asc || desc;
}

/**
 * Whether a NEW PIN is acceptable: 4–6 digits and not trivially guessable.
 * Existing PINs are never re-checked against this.
 */
export function isValidNewPin(pin: string): boolean {
  if (!isValidPinFormat(pin)) return false;
  if (isSameDigit(pin)) return false;
  if (isSequential(pin)) return false;
  if (WEAK_PINS.has(pin)) return false;
  return true;
}

/** Hash a PIN for storage. Sync is fine here: the owner sets PINs rarely. */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Constant-time check of a PIN against a stored "scrypt$salt$hash" string.
 * ASYNC so the key derivation runs on the libuv threadpool instead of
 * blocking the event loop (SEC-07). Same parameters as `hashPin`, so every
 * previously-stored hash still verifies.
 */
export async function verifyPin(
  pin: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scryptAsync(pin, salt, expected.length);
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

/** The cooldown that the Nth cumulative failure (a multiple of the batch size) earns. */
export function lockoutDurationMs(cumulativeFailures: number): number {
  const batch = Math.floor(cumulativeFailures / MAX_PIN_ATTEMPTS); // 1, 2, 3…
  const idx = Math.min(Math.max(batch, 1), PIN_LOCKOUT_LADDER_MS.length) - 1;
  return PIN_LOCKOUT_LADDER_MS[idx]!;
}

/**
 * Next lockout state after a wrong PIN. Every MAX_PIN_ATTEMPTS-th cumulative
 * failure sets a cooldown from the escalating ladder. The counter is NOT
 * reset here — only `clearedLockout()` (a correct PIN) resets it — so repeated
 * batches wait longer and longer rather than restarting at one minute.
 */
export function registerFailedAttempt(
  state: LockoutState,
  now: Date = new Date(),
): LockoutState {
  const attempts = state.failedPinAttempts + 1;
  if (attempts % MAX_PIN_ATTEMPTS === 0) {
    return {
      failedPinAttempts: attempts,
      pinLockedUntil: new Date(now.getTime() + lockoutDurationMs(attempts)),
    };
  }
  return { failedPinAttempts: attempts, pinLockedUntil: state.pinLockedUntil };
}

/** State after a correct PIN: a clean slate. */
export function clearedLockout(): LockoutState {
  return { failedPinAttempts: 0, pinLockedUntil: null };
}

/** "45s" / "5 minutes" / "1 hour" — for the "please wait" message. */
export function waitText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minutes`;
  const h = Math.ceil(m / 60);
  return h === 1 ? "1 hour" : `${h} hours`;
}
