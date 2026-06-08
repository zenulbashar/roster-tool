/** Cookie that carries the kiosk capability token on a shared device. */
export const KIOSK_COOKIE = "kiosk_token";

/**
 * Cookie that carries the personal-phone clock-in capability token. Separate
 * from the kiosk token/cookie so a personal phone only ever gets the
 * GPS-checked route. Scoped to /clock.
 */
export const PERSONAL_CLOCK_COOKIE = "personal_clock_token";
