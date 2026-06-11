/** Cookie that carries the kiosk capability token on a shared device. */
export const KIOSK_COOKIE = "kiosk_token";

/**
 * Cookie that carries the personal-phone clock-in capability token. Separate
 * from the kiosk token/cookie so a personal phone only ever gets the
 * GPS-checked route. Scoped to /clock.
 */
export const PERSONAL_CLOCK_COOKIE = "personal_clock_token";

/**
 * Cookie that carries a staff member's PRIVATE notices capability token
 * (the /me link). Per staff member, scoped to /me.
 */
export const NOTICES_COOKIE = "staff_notices_token";

/**
 * Short-lived, HMAC-signed proof that the /me visitor entered the staff
 * member's PIN (see src/lib/notices-verification.ts). Scoped to /me.
 */
export const NOTICES_VERIFIED_COOKIE = "staff_notices_verified";
