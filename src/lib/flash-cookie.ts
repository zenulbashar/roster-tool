import { env } from "@/lib/env";

/**
 * "Show once" flash cookies for freshly-generated capability links.
 *
 * When the owner generates a kiosk / personal-clock / staff-notices / Xero
 * invite link, only the HASH is stored; the raw token is handed to the next
 * render through a short-lived cookie so the full link can be shown exactly
 * once. The cookie is read SERVER-SIDE by the page and then cleared.
 *
 * SECURITY (SEC-18): these cookies carry secrets that are permanent until
 * manually rotated, so they are ALWAYS `httpOnly`. They used to be readable by
 * JavaScript so a client component could delete them — but that component only
 * ever deleted, never read, so the relaxed flag bought nothing while exposing
 * the tokens to any script on the page for five minutes. Clearing now happens
 * through a server action (`clearFlashCookie`), which is why every flash cookie
 * must be registered here: the action refuses to touch anything else.
 */

/** Registered flash cookies → the path they are scoped to. */
export const FLASH_COOKIES = {
  kiosk_link_once: "/app/settings",
  personal_clock_link_once: "/app/settings",
  xero_invite_once: "/app/settings",
  notices_link_once: "/app/staff",
} as const;

export type FlashCookieName = keyof typeof FLASH_COOKIES;

/** How long a just-generated link stays showable (seconds). */
export const FLASH_COOKIE_MAX_AGE_S = 300;

export function isFlashCookieName(name: string): name is FlashCookieName {
  return Object.prototype.hasOwnProperty.call(FLASH_COOKIES, name);
}

/**
 * The ONLY way a flash cookie is set: httpOnly, path-scoped to the page that
 * reads it, short-lived. Throws for an unregistered name so a new flash cookie
 * cannot be introduced without being clearable.
 */
export function flashCookieOptions(name: FlashCookieName) {
  if (!isFlashCookieName(name)) {
    throw new Error(`Unregistered flash cookie: ${name}`);
  }
  return {
    path: FLASH_COOKIES[name],
    maxAge: FLASH_COOKIE_MAX_AGE_S,
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
  };
}
