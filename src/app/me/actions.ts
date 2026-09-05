"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { createTenantRepo } from "@/lib/tenant/repository";
import { NOTICES_VERIFIED_COOKIE } from "@/lib/kiosk-cookie";
import {
  makeNoticesVerification,
  NOTICES_VERIFICATION_TTL_MS,
} from "@/lib/notices-verification";
import {
  noticesStaffFromCookie,
  verifiedNoticesStaff,
} from "@/lib/notices-session";
import { authenticateStaffPin } from "@/lib/pin-auth";
import { hashToken } from "@/lib/tokens";
import { NOTICES_COOKIE } from "@/lib/kiosk-cookie";

export type NoticesPinResult =
  | { status: "idle" }
  | { status: "error"; message: string };

const PATH = "/me";

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

  const repo = createTenantRepo(resolved.businessId);
  const now = new Date();
  // The shared, rate-limited PIN core, keyed on THIS person's link (the
  // capability token identifies who; the PIN proves it's them).
  const cookieStore = await cookies();
  const linkToken = cookieStore.get(NOTICES_COOKIE)?.value ?? "";
  const auth = await authenticateStaffPin(repo, {
    staffId: resolved.staffMemberId,
    pin: formData.get("pin"),
    deviceKey: hashToken(linkToken),
    now,
  });
  if (!auth.ok) return { status: "error", message: auth.message };
  const staff = auth.staff;

  // Correct PIN: set the short-lived proof.
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
