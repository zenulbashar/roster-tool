import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { hashToken } from "@/lib/tokens";

/**
 * Deliberately cross-tenant entry point for the staff clock-in kiosk.
 *
 * The kiosk is reached WITHOUT an owner session: a capability token in the URL
 * (then an httpOnly cookie) is what authenticates the device and yields the
 * `businessId`. Like the staff magic link and public roster, this is one of the
 * few places allowed to look up a business without a pre-known id. We compare on
 * the stored hash, never the raw token; the kiosk can only see what this returns
 * plus what a `createTenantRepo(businessId)` exposes — never owner pages.
 */

export type KioskBusiness = {
  businessId: string;
  name: string;
  timezone: string;
  requireClockInPhoto: boolean;
};

/** Resolve the kiosk's business from a raw capability token, or null. */
export async function resolveKioskBusiness(
  rawToken: string,
  database: Db = defaultDb,
): Promise<KioskBusiness | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const rows = await database
    .select({
      businessId: businesses.id,
      name: businesses.name,
      timezone: businesses.timezone,
      requireClockInPhoto: businesses.requireClockInPhoto,
    })
    .from(businesses)
    .where(eq(businesses.kioskTokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}
