import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { hashToken } from "@/lib/tokens";

/**
 * Cross-tenant entry point for personal-phone clock-in.
 *
 * Mirrors the kiosk resolver, but uses a SEPARATE capability token
 * (`personal_clock_token_hash`) so staff clocking in from their own phones only
 * ever get the GPS-checked route — they can't reach the no-location kiosk with
 * this link. Reached WITHOUT an owner session: the raw token in the URL (then an
 * httpOnly cookie) authenticates the device and yields the `businessId`. We
 * compare on the stored hash, never the raw token. The returned location fields
 * drive the geofence check; everything else goes through `createTenantRepo`.
 */

export type PersonalClockBusiness = {
  businessId: string;
  name: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
};

/** Resolve the personal-clock business from a raw capability token, or null. */
export async function resolvePersonalClockBusiness(
  rawToken: string,
  database: Db = defaultDb,
): Promise<PersonalClockBusiness | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const rows = await database
    .select({
      businessId: businesses.id,
      name: businesses.name,
      timezone: businesses.timezone,
      latitude: businesses.latitude,
      longitude: businesses.longitude,
      geofenceRadiusM: businesses.geofenceRadiusM,
    })
    .from(businesses)
    .where(eq(businesses.personalClockTokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}
