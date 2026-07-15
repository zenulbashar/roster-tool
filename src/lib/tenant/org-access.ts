import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, orgMemberships } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Resolves the organisation and the ACTIVE location for a signed-in owner, both
 * derived server-side and never trusted from client input (N1/N2 in
 * docs/multi-location-plan.md §5).
 *
 * - The org comes from the owner's `org_membership`.
 * - The active location is a cookie the switcher sets, but it is ONLY honoured
 *   after being validated against the org's own locations. A forged/stale value
 *   silently falls back to the owner's home business, then the org's first
 *   location — it can never point at another org's business.
 */

/** Cookie holding the owner's currently-selected location id. */
export const ACTIVE_LOCATION_COOKIE = "roster_active_location";

/** The org a signed-in owner belongs to, or null if they have no membership. */
export async function resolveOrgForUser(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ orgId: orgMemberships.orgId })
    .from(orgMemberships)
    .where(eq(orgMemberships.userId, userId))
    .limit(1);
  return row?.orgId ?? null;
}

/**
 * The active location id for this org, validated. Returns null only when the
 * org has no locations at all (a not-yet-onboarded state the caller redirects
 * on). Preference order: valid cookie → owner's home business → first location.
 */
export async function resolveActiveLocation(
  orgId: string,
  homeBusinessId: string | null,
): Promise<string | null> {
  const locations = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.orgId, orgId))
    .orderBy(asc(businesses.createdAt));
  if (locations.length === 0) return null;

  const validIds = new Set(locations.map((l) => l.id));
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_LOCATION_COOKIE)?.value;
  if (cookieValue && validIds.has(cookieValue)) return cookieValue;
  if (homeBusinessId && validIds.has(homeBusinessId)) return homeBusinessId;
  return locations[0]!.id;
}

/**
 * Set (or clear) the active-location cookie. The caller MUST have already
 * verified `businessId` belongs to the owner's org (N2) — this only writes the
 * cookie. Mirrors the other capability cookies' flags.
 */
export async function setActiveLocationCookie(
  businessId: string,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, businessId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    // Persist across sessions; the value is re-validated against the org on
    // every read, so a stale id is harmless.
    maxAge: 60 * 60 * 24 * 365,
  });
}
