import { and, eq, gt } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  availabilityRequests,
  publishedRosters,
  rosterPeriods,
} from "@/lib/db/schema";
import { hashToken } from "@/lib/tokens";

/**
 * Deliberately cross-tenant entry points.
 *
 * The staff magic link and the public roster view are reached WITHOUT a
 * session, so they can't start from a known business. Instead the secret in the
 * URL (a token, or an unguessable slug) is what authenticates the request and
 * yields the `businessId`. Callers must then scope all further work to that id
 * via `createTenantRepo(businessId)`.
 *
 * These are the only places allowed to query domain tables without a
 * pre-known business id — keep that list short.
 */

/**
 * Resolve an availability request from a raw magic-link token. Returns null if
 * the token is unknown or expired. We compare on the stored hash, never the
 * raw token.
 */
export async function findRequestByToken(
  rawToken: string,
  database: Db = defaultDb,
) {
  const tokenHash = hashToken(rawToken);
  const rows = await database
    .select()
    .from(availabilityRequests)
    .where(
      and(
        eq(availabilityRequests.tokenHash, tokenHash),
        gt(availabilityRequests.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Resolve a published roster (and its period) from a public slug. */
export async function findPublishedBySlug(
  slug: string,
  database: Db = defaultDb,
) {
  const rows = await database
    .select({
      businessId: publishedRosters.businessId,
      rosterPeriodId: publishedRosters.rosterPeriodId,
      publishedAt: publishedRosters.publishedAt,
      periodLabel: rosterPeriods.label,
      startDate: rosterPeriods.startDate,
      endDate: rosterPeriods.endDate,
    })
    .from(publishedRosters)
    .innerJoin(
      rosterPeriods,
      eq(publishedRosters.rosterPeriodId, rosterPeriods.id),
    )
    .where(eq(publishedRosters.publicSlug, slug))
    .limit(1);
  return rows[0] ?? null;
}
