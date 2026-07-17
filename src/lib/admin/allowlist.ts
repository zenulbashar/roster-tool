/**
 * Which emails may bootstrap into the Zale IT admin console (M37).
 *
 * An admin still signs in with the ordinary owner email magic link; on first
 * sign-in, `resolveAdmin` provisions a `platform_admin` row for any email listed
 * here. Kept small + env-driven (`ADMIN_ALLOWLIST`) so grants are auditable and
 * revocable without shipping code. FAIL CLOSED: an empty/unset allow-list
 * provisions nobody — existing `platform_admin` rows still work, but no new
 * admin can appear from a stray sign-in.
 */

/** Parse the raw env value into a deduped, lowercased list of emails. */
export function parseAdminAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  );
}

/** Whether `email` (case-insensitively) is on the allow-list. */
export function isEmailAllowed(
  email: string | undefined | null,
  allowlist: string[],
): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}
