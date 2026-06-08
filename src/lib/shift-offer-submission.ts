import type { TenantRepo } from "@/lib/tenant/repository";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  PIN_LOCKOUT_MS,
} from "@/lib/pin";
import { pinSchema } from "@/lib/validation";
import { timesOverlap } from "@/lib/shift-offer";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";

/**
 * Shared cores for staff releasing / claiming / cancelling shift offers from
 * BOTH clock surfaces (`/clock`, `/kiosk`). The caller resolves the business
 * from its own capability token and passes a tenant-scoped `repo` — the
 * business is NEVER taken from client input. Staff are authenticated by the
 * same PIN + per-staff lockout as clock-in. No geofence (not a clock action).
 */

export type ShiftActionResult =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type Staff = NonNullable<Awaited<ReturnType<TenantRepo["getStaff"]>>>;

type AuthResult = { ok: true; staff: Staff } | { ok: false; message: string };

/** Verify staffId + PIN from the form with the per-staff brute-force guard. */
async function authStaff(
  repo: TenantRepo,
  formData: FormData,
  now: Date,
): Promise<AuthResult> {
  const staffId = formData.get("staffId");
  const pinParsed = pinSchema.safeParse(formData.get("pin"));
  if (typeof staffId !== "string" || !staffId || !pinParsed.success) {
    return { ok: false, message: "Enter your 4-digit PIN." };
  }
  const staff = await repo.getStaff(staffId);
  if (!staff || !staff.active || !staff.pinHash) {
    return { ok: false, message: "That PIN didn't match. Try again." };
  }
  const lock = isLockedOut(
    {
      failedPinAttempts: staff.failedPinAttempts,
      pinLockedUntil: staff.pinLockedUntil,
    },
    now,
  );
  if (lock.locked) {
    const secs = Math.ceil(lock.retryAfterMs / 1000);
    return {
      ok: false,
      message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
    };
  }
  if (!verifyPin(pinParsed.data, staff.pinHash)) {
    const next = registerFailedAttempt(
      {
        failedPinAttempts: staff.failedPinAttempts,
        pinLockedUntil: staff.pinLockedUntil,
      },
      now,
    );
    await repo.updateStaffLockout(staff.id, next);
    if (next.pinLockedUntil) {
      const secs = Math.ceil(PIN_LOCKOUT_MS / 1000);
      return {
        ok: false,
        message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
      };
    }
    return { ok: false, message: "That PIN didn't match. Try again." };
  }
  // Correct PIN: wipe the brute-force counter.
  await repo.updateStaffLockout(staff.id, clearedLockout());
  return { ok: true, staff };
}

/** A staff member offers up (releases) a confirmed shift they hold. */
export async function releaseShiftForStaff(
  repo: TenantRepo,
  formData: FormData,
  now: Date = new Date(),
): Promise<ShiftActionResult> {
  const auth = await authStaff(repo, formData, now);
  if (!auth.ok) return { status: "error", message: auth.message };

  const shiftId = formData.get("shiftId");
  if (typeof shiftId !== "string" || !shiftId) {
    return { status: "error", message: "Something went wrong. Try again." };
  }
  const res = await repo.releaseOwnShift(auth.staff.id, shiftId);
  if (!res.ok) return { status: "error", message: res.reason };

  return {
    status: "success",
    message: `Thanks ${auth.staff.name}, your shift is now offered up. You stay on it until your manager confirms a replacement.`,
  };
}

/** A staff member claims an open offer (subject to owner approval). */
export async function claimShiftForStaff(
  repo: TenantRepo,
  formData: FormData,
  now: Date = new Date(),
): Promise<ShiftActionResult> {
  const auth = await authStaff(repo, formData, now);
  if (!auth.ok) return { status: "error", message: auth.message };

  const offerId = formData.get("offerId");
  if (typeof offerId !== "string" || !offerId) {
    return { status: "error", message: "Something went wrong. Try again." };
  }
  const res = await repo.claimOffer(offerId, auth.staff.id);
  if (!res.ok) return { status: "error", message: res.reason };

  // Non-blocking heads-up if this clashes with their leave or another shift.
  const shift = await repo.getPublishedShift(res.offer.shiftId);
  let when = "";
  let heads = "";
  if (shift) {
    when = ` for ${shift.label} on ${formatDateOnly(shift.date)} (${formatTimeOnly(shift.startTime)} – ${formatTimeOnly(shift.endTime)})`;
    const [onLeave, sameDay] = await Promise.all([
      repo.hasApprovedLeaveOn(auth.staff.id, shift.date),
      repo.confirmedShiftsForStaffOnDate(auth.staff.id, shift.date, shift.id),
    ]);
    const overlap = sameDay.some((x) =>
      timesOverlap(shift.startTime, shift.endTime, x.startTime, x.endTime),
    );
    if (onLeave) {
      heads =
        " Heads up: you have approved leave that day — your manager will see that.";
    } else if (overlap) {
      heads =
        " Heads up: this overlaps another shift you're on that day — your manager will see that.";
    }
  }

  return {
    status: "success",
    message: `Thanks ${auth.staff.name}, you've claimed this shift${when}. Your manager will confirm it.${heads}`,
  };
}

/** A staff member cancels their OWN still-open offer (open only). */
export async function withdrawOwnOffer(
  repo: TenantRepo,
  formData: FormData,
  now: Date = new Date(),
): Promise<ShiftActionResult> {
  const auth = await authStaff(repo, formData, now);
  if (!auth.ok) return { status: "error", message: auth.message };

  const offerId = formData.get("offerId");
  if (typeof offerId !== "string" || !offerId) {
    return { status: "error", message: "Something went wrong. Try again." };
  }
  const row = await repo.withdrawOffer(offerId, { byStaffId: auth.staff.id });
  if (!row) {
    return {
      status: "error",
      message: "Couldn't cancel — it may have been claimed or already handled.",
    };
  }
  return {
    status: "success",
    message: `Cancelled. You're keeping this shift, ${auth.staff.name}.`,
  };
}
