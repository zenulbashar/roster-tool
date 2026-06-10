"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveNoticesStaff } from "@/lib/tenant/notices-access";
import { NOTICES_COOKIE, NOTICES_VERIFIED_COOKIE } from "@/lib/kiosk-cookie";
import {
  makeNoticesVerification,
  checkNoticesVerification,
  NOTICES_VERIFICATION_TTL_MS,
} from "@/lib/notices-verification";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  PIN_LOCKOUT_MS,
} from "@/lib/pin";
import { pinSchema } from "@/lib/validation";

export type NoticesPinResult =
  | { status: "idle" }
  | { status: "error"; message: string };

const PATH = "/me";

/** The staff member the /me capability cookie resolves to, or null. */
async function noticesStaffFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(NOTICES_COOKIE)?.value ?? "";
  return resolveNoticesStaff(token);
}

/** Whether the visitor holds a valid PIN-verification proof for this staff member. */
async function hasNoticesVerification(staffMemberId: string): Promise<boolean> {
  const cookieStore = await cookies();
  return checkNoticesVerification(
    cookieStore.get(NOTICES_VERIFIED_COOKIE)?.value,
    staffMemberId,
    env.AUTH_SECRET,
  );
}

/**
 * Verify the staff member's PIN for /me. The link's cookie says WHO; this
 * proves it's them, with the same per-staff lockout as the clock surfaces. On
 * success we set the short-lived signed proof cookie and re-render the page.
 */
export async function noticesPinAction(
  _prev: NoticesPinResult,
  formData: FormData,
): Promise<NoticesPinResult> {
  const resolved = await noticesStaffFromCookie();
  if (!resolved) {
    return {
      status: "error",
      message: "This link is no longer active. Ask your manager for a new one.",
    };
  }

  const pinParsed = pinSchema.safeParse(formData.get("pin"));
  if (!pinParsed.success) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

  const repo = createTenantRepo(resolved.businessId);
  const staff = await repo.getStaff(resolved.staffMemberId);
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

  // Correct PIN: wipe the brute-force counter and set the short-lived proof.
  await repo.updateStaffLockout(staff.id, clearedLockout());
  const cookieStore = await cookies();
  cookieStore.set(
    NOTICES_VERIFIED_COOKIE,
    makeNoticesVerification(staff.id, env.AUTH_SECRET, now),
    {
      path: PATH,
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: Math.floor(NOTICES_VERIFICATION_TTL_MS / 1000),
    },
  );
  redirect(PATH);
}

/**
 * Both cookies re-checked per action: the capability cookie says who, the
 * proof cookie shows the PIN was entered for that SAME staff member.
 */
async function verifiedNoticesStaff() {
  const resolved = await noticesStaffFromCookie();
  if (!resolved) return null;
  return (await hasNoticesVerification(resolved.staffMemberId))
    ? resolved
    : null;
}

/** Mark one of MY notices read. A foreign id no-ops (repo scopes by staff). */
export async function markNoticeReadAction(formData: FormData): Promise<void> {
  const resolved = await verifiedNoticesStaff();
  if (!resolved) redirect(PATH);
  const id = String(formData.get("id"));
  await createTenantRepo(resolved.businessId).markStaffNotificationRead(
    id,
    resolved.staffMemberId,
  );
  revalidatePath(PATH);
}

/** Mark all MY notices read. */
export async function markAllNoticesReadAction(): Promise<void> {
  const resolved = await verifiedNoticesStaff();
  if (!resolved) redirect(PATH);
  await createTenantRepo(resolved.businessId).markAllStaffNotificationsRead(
    resolved.staffMemberId,
  );
  revalidatePath(PATH);
}
