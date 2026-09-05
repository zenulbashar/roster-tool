"use server";

import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { resolvePersonalClockBusiness } from "@/lib/tenant/personal-clock-access";
import { resolveOrgIdForBusiness } from "@/lib/tenant/org-access";
import { PERSONAL_CLOCK_COOKIE } from "@/lib/kiosk-cookie";
import { authenticateStaffPinFromForm } from "@/lib/pin-auth";
import { hashToken } from "@/lib/tokens";
import { pinSchema, coordinatesSchema } from "@/lib/validation";
import { isWithinRadius } from "@/lib/geo";
import { businessDateOf, formatTimeOnly } from "@/lib/time";
import { formatElapsed, entryDurationMs } from "@/lib/clock";
import {
  submitStaffLeave,
  type LeaveSubmitResult,
} from "@/lib/leave-submission";
import {
  releaseShiftForStaff,
  claimShiftForStaff,
  claimOrgOfferForStaff,
  withdrawOwnOffer,
  type ShiftActionResult,
} from "@/lib/shift-offer-submission";
import {
  submitStockCheck,
  type StockCheckResult,
} from "@/lib/stock-check-submission";

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
    return { status: "error", message: "Enter your PIN." };
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
  const now = new Date();
  // The shared, rate-limited PIN core: device limit (this clock link) →
  // per-staff escalating lockout → async verify. Generic errors throughout.
  const auth = await authenticateStaffPinFromForm(repo, formData, {
    deviceKey: hashToken(token),
    now,
  });
  if (!auth.ok) return { status: "error", message: auth.message };
  const staff = auth.staff;

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
  return submitStaffLeave(
    createTenantRepo(business.businessId),
    formData,
    new Date(),
    { deviceKey: hashToken(token) },
  );
}

/**
 * Resolve the personal-clock business from the cookie, or null. Also yields
 * the per-device PIN rate-limit key (the token's hash — never a staff id).
 */
async function personalClockRepo() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PERSONAL_CLOCK_COOKIE)?.value ?? "";
  const business = await resolvePersonalClockBusiness(token);
  if (!business) return null;
  return {
    repo: createTenantRepo(business.businessId),
    deviceKey: hashToken(token),
  };
}

const LINK_GONE = "This clock-in link is no longer active. Ask your manager.";

/** Offer up a shift from a staff member's own phone (PIN, no geofence). */
export async function personalClockReleaseAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const k = await personalClockRepo();
  if (!k) return { status: "error", message: LINK_GONE };
  return releaseShiftForStaff(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}

/** Claim an open shift from a staff member's own phone. */
export async function personalClockClaimAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const k = await personalClockRepo();
  if (!k) return { status: "error", message: LINK_GONE };
  return claimShiftForStaff(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}

/** Cancel your own still-open offer from a staff member's own phone. */
export async function personalClockCancelOfferAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const k = await personalClockRepo();
  if (!k) return { status: "error", message: LINK_GONE };
  return withdrawOwnOffer(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}

/** Claim an org-scoped open shift from ANOTHER location (M29 Phase 3). */
export async function personalClockClaimOrgAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PERSONAL_CLOCK_COOKIE)?.value ?? "";
  const business = await resolvePersonalClockBusiness(token);
  if (!business) return { status: "error", message: LINK_GONE };
  const orgId = await resolveOrgIdForBusiness(business.businessId);
  if (!orgId) return { status: "error", message: LINK_GONE };
  return claimOrgOfferForStaff(
    createTenantRepo(business.businessId),
    createOrgRepo(orgId),
    formData,
    new Date(),
    { deviceKey: hashToken(token) },
  );
}

/** Submit a stock check from a staff member's own phone (PIN, no geofence). */
export async function personalClockStockCheckAction(
  _prev: StockCheckResult,
  formData: FormData,
): Promise<StockCheckResult> {
  const k = await personalClockRepo();
  if (!k) return { status: "error", message: LINK_GONE };
  return submitStockCheck(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}
