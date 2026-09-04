"use server";

import { cookies } from "next/headers";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { resolveOrgIdForBusiness } from "@/lib/tenant/org-access";
import { KIOSK_COOKIE } from "@/lib/kiosk-cookie";
import { authenticateStaffPinFromForm } from "@/lib/pin-auth";
import { hashToken } from "@/lib/tokens";
import { parseClockPhoto } from "@/lib/validation";
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

  const repo = createTenantRepo(business.businessId);
  const now = new Date();
  // The shared, rate-limited PIN core: device limit (this kiosk link) →
  // per-staff escalating lockout → async verify. Generic errors throughout.
  const auth = await authenticateStaffPinFromForm(repo, formData, {
    deviceKey: hashToken(token),
    now,
  });
  if (!auth.ok) return { status: "error", message: auth.message };
  const staff = auth.staff;

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
  return submitStaffLeave(
    createTenantRepo(business.businessId),
    formData,
    new Date(),
    { deviceKey: hashToken(token) },
  );
}

/**
 * Resolve the kiosk business from the cookie, or null. Also yields the
 * per-device PIN rate-limit key (the token's hash — never a staff id).
 */
async function kioskRepo() {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value ?? "";
  const business = await resolveKioskBusiness(token);
  if (!business) return null;
  return {
    repo: createTenantRepo(business.businessId),
    deviceKey: hashToken(token),
  };
}

const KIOSK_LINK_GONE =
  "This kiosk link is no longer active. Ask your manager.";

/** Offer up a shift from the shared kiosk (PIN, no geofence). */
export async function kioskReleaseAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const k = await kioskRepo();
  if (!k) return { status: "error", message: KIOSK_LINK_GONE };
  return releaseShiftForStaff(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}

/** Claim an open shift from the shared kiosk. */
export async function kioskClaimAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const k = await kioskRepo();
  if (!k) return { status: "error", message: KIOSK_LINK_GONE };
  return claimShiftForStaff(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}

/** Cancel your own still-open offer from the shared kiosk. */
export async function kioskCancelOfferAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const k = await kioskRepo();
  if (!k) return { status: "error", message: KIOSK_LINK_GONE };
  return withdrawOwnOffer(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}

/** Claim an org-scoped open shift from ANOTHER location (M29 Phase 3). */
export async function kioskClaimOrgAction(
  _prev: ShiftActionResult,
  formData: FormData,
): Promise<ShiftActionResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(KIOSK_COOKIE)?.value ?? "";
  const business = await resolveKioskBusiness(token);
  if (!business) return { status: "error", message: KIOSK_LINK_GONE };
  const orgId = await resolveOrgIdForBusiness(business.businessId);
  if (!orgId) return { status: "error", message: KIOSK_LINK_GONE };
  return claimOrgOfferForStaff(
    createTenantRepo(business.businessId),
    createOrgRepo(orgId),
    formData,
    new Date(),
    { deviceKey: hashToken(token) },
  );
}

/** Submit a stock check from the shared kiosk (PIN, no geofence). */
export async function kioskStockCheckAction(
  _prev: StockCheckResult,
  formData: FormData,
): Promise<StockCheckResult> {
  const k = await kioskRepo();
  if (!k) return { status: "error", message: KIOSK_LINK_GONE };
  return submitStockCheck(k.repo, formData, new Date(), {
    deviceKey: k.deviceKey,
  });
}
