"use server";

import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { KIOSK_COOKIE } from "@/lib/kiosk-cookie";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  PIN_LOCKOUT_MS,
} from "@/lib/pin";
import { pinSchema, parseClockPhoto } from "@/lib/validation";
import { businessDateOf, formatTimeOnly } from "@/lib/time";
import { formatElapsed, entryDurationMs } from "@/lib/clock";
import { submitStaffLeave, type LeaveSubmitResult } from "@/lib/leave-submission";

export type ClockResult =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/** A friendly clock-time ("9:05 am") for an instant in the business timezone. */
function clockTime(instant: Date, timeZone: string): string {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return formatTimeOnly(hhmm);
}

/**
 * Clock a staff member in or out from the kiosk. The business comes from the
 * kiosk cookie (never client input); the staff member is authenticated by their
 * PIN, guarded by a per-staff cooldown after repeated wrong PINs. Toggles state:
 * an open entry clocks out, otherwise we clock in (linking a rostered shift when
 * one matches today). A photo is stored only when the setting is on and one was
 * captured — a missing photo never blocks clocking.
 */
export async function clockAction(
  _prev: ClockResult,
  formData: FormData,
): Promise<ClockResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value ?? "";
  const business = await resolveKioskBusiness(token);
  if (!business) {
    return {
      status: "error",
      message: "This kiosk link is no longer active. Ask your manager.",
    };
  }

  const staffId = formData.get("staffId");
  const pinParsed = pinSchema.safeParse(formData.get("pin"));
  if (typeof staffId !== "string" || !staffId || !pinParsed.success) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

  const repo = createTenantRepo(business.businessId);
  const staff = await repo.getStaff(staffId);
  // Same generic message whether the person is missing, inactive or PIN-less,
  // so the kiosk doesn't reveal who has a PIN.
  if (!staff || !staff.active || !staff.pinHash) {
    return { status: "error", message: "That PIN didn't match. Try again." };
  }

  const now = new Date();
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
      status: "error",
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
        status: "error",
        message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
      };
    }
    return { status: "error", message: "That PIN didn't match. Try again." };
  }

  // Correct PIN: wipe the brute-force counter.
  await repo.updateStaffLockout(staff.id, clearedLockout());

  const open = await repo.getOpenEntry(staff.id);
  let entryId: string;
  let kind: "in" | "out";
  let message: string;
  if (open) {
    const closed = await repo.clockOut(open.id, now);
    entryId = open.id;
    kind = "out";
    const worked = formatElapsed(
      entryDurationMs({ clockInAt: open.clockInAt, clockOutAt: now }, now),
    );
    message = `${staff.name}, you clocked out at ${clockTime(now, business.timezone)} — ${worked} worked.`;
    if (!closed) {
      return { status: "error", message: "Couldn't clock out. Try again." };
    }
  } else {
    const shiftId = await repo.findRosteredShiftForStaffOnDate(
      staff.id,
      businessDateOf(now, business.timezone),
    );
    const entry = await repo.clockIn(staff.id, { shiftId, at: now });
    entryId = entry.id;
    kind = "in";
    message = `${staff.name}, you clocked in at ${clockTime(now, business.timezone)}.`;
  }

  // Best-effort photo: only when the setting is on and one was captured.
  if (business.requireClockInPhoto) {
    const photo = parseClockPhoto(formData.get("photo"));
    if (photo) {
      await repo.addClockPhoto({
        timesheetEntryId: entryId,
        kind,
        mimeType: photo.mimeType,
        imageData: photo.data,
      });
    }
  }

  return { status: "success", message };
}

/**
 * Submit a leave request from the shared kiosk. Business comes from the kiosk
 * cookie (never client input); the staff member is PIN-authed by the shared
 * core. No geofence — leave isn't a clock action.
 */
export async function kioskLeaveAction(
  _prev: LeaveSubmitResult,
  formData: FormData,
): Promise<LeaveSubmitResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value ?? "";
  const business = await resolveKioskBusiness(token);
  if (!business) {
    return {
      status: "error",
      message: "This kiosk link is no longer active. Ask your manager.",
    };
  }
  return submitStaffLeave(createTenantRepo(business.businessId), formData);
}
