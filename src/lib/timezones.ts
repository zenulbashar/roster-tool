/**
 * Australian IANA timezones offered when creating a business/organisation or a
 * location. Shared by onboarding and the locations page so the option set and
 * the zod enum stay in one place.
 */
export const AU_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Hobart",
  "Australia/Darwin",
] as const;

export type AuTimezone = (typeof AU_TIMEZONES)[number];
