import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolveNoticesStaff } from "@/lib/tenant/notices-access";
import { NOTICES_COOKIE, NOTICES_VERIFIED_COOKIE } from "@/lib/kiosk-cookie";
import { checkNoticesVerification } from "@/lib/notices-verification";

/**
 * The /me staff-session gate, shared by every /me page + action.
 *
 * Identity comes ONLY from two httpOnly cookies — the capability token (says
 * WHO) and the short-lived HMAC PIN proof (says the PIN was entered for that
 * SAME staff member). It is NEVER derived from request/form input. Any feature
 * that needs the current staff member (notices, internal form fills) must read
 * it through here so the rule can't drift.
 */

/** The staff member the /me capability cookie resolves to, or null. */
export async function noticesStaffFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(NOTICES_COOKIE)?.value ?? "";
  return resolveNoticesStaff(token);
}

/** Whether the visitor holds a valid PIN-verification proof for this staff member. */
export async function hasNoticesVerification(
  staffMemberId: string,
): Promise<boolean> {
  const cookieStore = await cookies();
  return checkNoticesVerification(
    cookieStore.get(NOTICES_VERIFIED_COOKIE)?.value,
    staffMemberId,
    env.AUTH_SECRET,
  );
}

/**
 * Both cookies re-checked together: the capability cookie says who, the proof
 * cookie shows the PIN was entered for that SAME staff member. Returns the
 * resolved staff (businessId + staffMemberId + names) or null.
 */
export async function verifiedNoticesStaff() {
  const resolved = await noticesStaffFromCookie();
  if (!resolved) return null;
  return (await hasNoticesVerification(resolved.staffMemberId))
    ? resolved
    : null;
}
