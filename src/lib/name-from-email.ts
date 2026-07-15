/**
 * Derive a human-friendly full name from an email address, as a convenience
 * default when adding a staff member. Pure + deterministic (no external calls)
 * so it's unit-testable and safe to run on the client.
 *
 * Takes the local part (before `@`), drops any `+tag`, splits on separators
 * (`.` `_` `-`), strips digits, and title-cases each remaining token:
 *   "john.doe@cafe.com"        -> "John Doe"
 *   "mary_jane.smith@x.com"    -> "Mary Jane Smith"
 *   "j.doe+roster@x.com"       -> "J Doe"
 *   "roster123@x.com"          -> "Roster"
 * Returns "" when nothing usable remains (e.g. an all-numeric local part), so
 * callers can leave the field untouched rather than filling in junk.
 */
export function nameFromEmail(email: string): string {
  const at = email.indexOf("@");
  const local = (at >= 0 ? email.slice(0, at) : email).trim();
  const beforeTag = local.split("+")[0] ?? local;
  return beforeTag
    .split(/[._-]+/)
    .map((token) => token.replace(/[0-9]+/g, "").trim())
    .filter(Boolean)
    .map(
      (token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join(" ");
}
