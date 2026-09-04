"use server";

import { cookies } from "next/headers";
import { FLASH_COOKIES, isFlashCookieName } from "@/lib/flash-cookie";

/**
 * Clear a "show once" flash cookie after the page has rendered the link it
 * carried. Called by the `ClearFlashCookie` client component on mount — the
 * cookies are httpOnly (SEC-18), so JavaScript cannot delete them itself.
 *
 * Only REGISTERED flash cookie names are honoured; the client can never use
 * this to delete anything else (the session cookie, the impersonation grant,
 * the active-location choice). The path comes from the registry, not the
 * caller, so it always matches how the cookie was set.
 */
export async function clearFlashCookie(name: string): Promise<void> {
  if (!isFlashCookieName(name)) return;
  const store = await cookies();
  store.delete({ name, path: FLASH_COOKIES[name] });
}
