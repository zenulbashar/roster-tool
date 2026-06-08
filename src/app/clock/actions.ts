"use server";

import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolvePersonalClockBusiness } from "@/lib/tenant/personal-clock-access";
import { PERSONAL_CLOCK_COOKIE } from "@/lib/kiosk-cookie";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  PIN_LOCKOUT_MS,
} from "@/lib/pin";
import { pinSchema, coordinatesSchema } from "@/lib/validation";
import { isWithinRadius } from "@/lib/geo";
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

const LOCATION_REQUIRED =
  "We couldn't check your location. You can only clock in from your phone while you're at work — use the in-store kiosk, or ask your manager to add your hours.";

/**
 * Clock a staff member in or out from their OWN phone, with a location check.
 *
 * The business comes from the personal-clock cookie (never client input); the
 * staff member is authenticated by PIN with the same per-staff cooldown as the
 * kiosk. Unlike the kiosk, this REQUIRES a geofenced location: we read the
 * phone's coordinates at the tap, compute distance to the shop, and block if the
 * person is outside the radius (for both clock in and clock out — you must be at
 * work). A blocked attempt never creates or changes an entry. The owner can
 * always add/edit entries from the timesheets page as the release valve.
 */
export async function personalClockAction(
  _prev: ClockResult,
  formData: FormData,
): Promise<ClockResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PERSONAL_CLOCK_COOKIE)?.value ?? "";
  const business = await resolvePersonalClockBusiness(token);
  if (!business) {
    return {
      status: "error",
      message: "This clock-in link is no longer active. Ask your manager.",
    };
  }

  const staffId = formData.get("staffId");
  const pinParsed = pinSchema.safeParse(formData.get("pin"));
  if (typeof staffId !== "string" || !staffId || !pinParsed.success) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

  // Coordinates must be present and valid. We guard for empty strings because
  // z.coerce.number() would otherwise turn "" / null into 0 (a real location).
  const latRaw = formData.get("lat");
  const lngRaw = formData.get("lng");
  if (
    typeof latRaw !== "string" ||
    typeof lngRaw !== "string" ||
    latRaw === "" ||
    lngRaw === ""
  ) {
    return { status: "error", message: LOCATION_REQUIRED };
  }
  const coords = coordinatesSchema.safeParse({ lat: latRaw, lng: lngRaw });
  if (!coords.success) {
    return { status: "error", message: LOCATION_REQUIRED };
  }

  const repo = createTenantRepo(business.businessId);
  const staff = await repo.getStaff(staffId);
  // Same generic message whether the person is missing, inactive or PIN-less.
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

  // Geofence. Without a shop location we can't verify, so we block rather than
  // silently allow.
  if (business.latitude === null || business.longitude === null) {
    return {
      status: "error",
      message:
        "Phone clock-in isn't set up yet — ask your manager to set the shop location.",
    };
  }
  const inside = isWithinRadius(
    { lat: coords.data.lat, lng: coords.data.lng },
    { lat: business.latitude, lng: business.longitude },
    business.geofenceRadiusM,
  );
  if (!inside) {
    return {
      status: "error",
      message: `You don't appear to be at ${business.name} — you can only clock in at work.`,
    };
  }

  const open = await repo.getOpenEntry(staff.id);
  if (open) {
    const closed = await repo.clockOut(open.id, now);
    if (!closed) {
      return { status: "error", message: "Couldn't clock out. Try again." };
    }
    const worked = formatElapsed(
      entryDurationMs({ clockInAt: open.clockInAt, clockOutAt: now }, now),
    );
    return {
      status: "success",
      message: `${staff.name}, you clocked out at ${clockTime(now, business.timezone)} — ${worked} worked.`,
    };
  }

  const shiftId = await repo.findRosteredShiftForStaffOnDate(
    staff.id,
    businessDateOf(now, business.timezone),
  );
  await repo.clockIn(staff.id, {
    shiftId,
    at: now,
    lat: coords.data.lat,
    lng: coords.data.lng,
    withinGeofence: true,
  });
  return {
    status: "success",
    message: `${staff.name}, you clocked in at ${clockTime(now, business.timezone)}.`,
  };
}

/**
 * Submit a leave request from a staff member's own phone. Business comes from
 * the personal-clock cookie (never client input); the staff member is PIN-authed
 * by the shared core. Deliberately NO geofence — requesting time off isn't a
 * clock action, so it can be done from anywhere.
 */
export async function personalClockLeaveAction(
  _prev: LeaveSubmitResult,
  formData: FormData,
): Promise<LeaveSubmitResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PERSONAL_CLOCK_COOKIE)?.value ?? "";
  const business = await resolvePersonalClockBusiness(token);
  if (!business) {
    return {
      status: "error",
      message: "This clock-in link is no longer active. Ask your manager.",
    };
  }
  return submitStaffLeave(createTenantRepo(business.businessId), formData);
}
