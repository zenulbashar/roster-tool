import type { TenantRepo } from "@/lib/tenant/repository";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  waitText,
} from "@/lib/pin";
import { consumePinAttempt } from "@/lib/rate-limit";
import { pinSchema } from "@/lib/validation";

/**
 * THE one PIN check for every staff surface (kiosk clock, personal-phone
 * clock, leave, stock check, shift offers, /me). It used to be six near-
 * identical copies; a shared core means the brute-force guard, the device
 * rate limit and the generic-error rule can't drift between surfaces.
 *
 * Order:
 *  1. PIN shape (never reveals whether the person exists).
 *  2. Per-DEVICE rate limit on the capability token (`deviceKey`) — caps the
 *     attacker, so one bad actor can't lock a whole venue out (SEC-06).
 *  3. Load the staff member through the tenant repo (`memberHere`-scoped).
 *  4. Per-staff escalating lockout.
 *  5. Async scrypt verify (SEC-07).
 *  6. Wrong → persist the cumulative failure (and any new lock); right → clear.
 *
 * Every failure returns the SAME generic message, whether the person is
 * missing, inactive, PIN-less or simply wrong, so the surface never confirms
 * who has a PIN. `deviceKey` is optional only so the pure submission cores can
 * be exercised in tests without a token; every real surface passes one.
 */

export type Staff = NonNullable<Awaited<ReturnType<TenantRepo["getStaff"]>>>;

export type PinAuthResult =
  | { ok: true; staff: Staff }
  | { ok: false; message: string };

export const PIN_MISMATCH_MESSAGE = "That PIN didn't match. Try again.";
export const PIN_SHAPE_MESSAGE = "Enter your PIN.";
export const PIN_DEVICE_LIMIT_MESSAGE =
  "Too many PIN attempts from this device. Please wait a minute and try again.";

function lockedMessage(retryAfterMs: number): string {
  return `Too many wrong PINs. Please wait ${waitText(retryAfterMs)} and try again.`;
}

export async function authenticateStaffPin(
  repo: TenantRepo,
  input: {
    staffId: unknown;
    pin: unknown;
    /** SHA-256 of the surface's capability token; see consumePinAttempt. */
    deviceKey?: string;
    now?: Date;
  },
): Promise<PinAuthResult> {
  const now = input.now ?? new Date();
  const pinParsed = pinSchema.safeParse(input.pin);
  if (
    typeof input.staffId !== "string" ||
    !input.staffId ||
    !pinParsed.success
  ) {
    return { ok: false, message: PIN_SHAPE_MESSAGE };
  }

  if (input.deviceKey) {
    const allowed = await consumePinAttempt(
      input.deviceKey,
      undefined,
      now.getTime(),
    );
    if (!allowed) return { ok: false, message: PIN_DEVICE_LIMIT_MESSAGE };
  }

  const staff = await repo.getStaff(input.staffId);
  if (!staff || !staff.active || !staff.pinHash) {
    return { ok: false, message: PIN_MISMATCH_MESSAGE };
  }

  const lock = isLockedOut(
    {
      failedPinAttempts: staff.failedPinAttempts,
      pinLockedUntil: staff.pinLockedUntil,
    },
    now,
  );
  if (lock.locked) {
    return { ok: false, message: lockedMessage(lock.retryAfterMs) };
  }

  if (!(await verifyPin(pinParsed.data, staff.pinHash))) {
    const next = registerFailedAttempt(
      {
        failedPinAttempts: staff.failedPinAttempts,
        pinLockedUntil: staff.pinLockedUntil,
      },
      now,
    );
    await repo.updateStaffLockout(staff.id, next);
    if (next.pinLockedUntil && next.pinLockedUntil > now) {
      return {
        ok: false,
        message: lockedMessage(next.pinLockedUntil.getTime() - now.getTime()),
      };
    }
    return { ok: false, message: PIN_MISMATCH_MESSAGE };
  }

  // Correct PIN: wipe the brute-force counter.
  await repo.updateStaffLockout(staff.id, clearedLockout());
  return { ok: true, staff };
}

/** The form-driven variant every staff form uses (`staffId` + `pin` fields). */
export function authenticateStaffPinFromForm(
  repo: TenantRepo,
  formData: FormData,
  opts: { deviceKey?: string; now?: Date } = {},
): Promise<PinAuthResult> {
  return authenticateStaffPin(repo, {
    staffId: formData.get("staffId"),
    pin: formData.get("pin"),
    deviceKey: opts.deviceKey,
    now: opts.now,
  });
}
