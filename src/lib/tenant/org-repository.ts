import { and, asc, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { businesses, organisations } from "@/lib/db/schema";

/**
 * Organisation-scoped data access for the multi-location feature (M29). Mirrors
 * `createTenantRepo`, but the tenant here is the ORGANISATION: every read/write
 * filters by — and forces — the `org_id` captured when the repo is created. The
 * `orgId` must come from a trusted source (the owner's membership, resolved
 * server-side in `src/lib/tenant/org-access.ts`), never client input.
 *
 * This repo only ever touches org-scoped tables (organisation + the locations
 * that belong to it). Per-location domain work still goes through
 * `createTenantRepo(businessId)` after the location is confirmed to belong to
 * this org — the org repo never bypasses per-location scoping.
 */
export function createOrgRepo(orgId: string, database: Db = defaultDb) {
  return {
    orgId,

    /** The organisation row, or null. */
    async getOrganisation() {
      const [row] = await database
        .select()
        .from(organisations)
        .where(eq(organisations.id, orgId));
      return row ?? null;
    },

    /** All locations in this org, oldest first (stable switcher order). */
    listLocations() {
      return database
        .select({
          id: businesses.id,
          name: businesses.name,
          timezone: businesses.timezone,
          createdAt: businesses.createdAt,
        })
        .from(businesses)
        .where(eq(businesses.orgId, orgId))
        .orderBy(asc(businesses.createdAt));
    },

    /**
     * True iff `businessId` is a location in THIS org. The N2 guard: an active
     * location / any location id taken from a cookie, form or link must pass
     * this before it is used to build a tenant repo.
     */
    async locationBelongsToOrg(businessId: string): Promise<boolean> {
      const [row] = await database
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, businessId), eq(businesses.orgId, orgId)));
      return Boolean(row);
    },

    /** Add a location to this org. `org_id` is forced from the repo. */
    async createLocation(input: { name: string; timezone: string }) {
      const [row] = await database
        .insert(businesses)
        .values({ name: input.name, timezone: input.timezone, orgId })
        .returning({
          id: businesses.id,
          name: businesses.name,
          timezone: businesses.timezone,
        });
      return row!;
    },

    /** How many locations this org has (for "can't delete the last one" etc.). */
    async countLocations(): Promise<number> {
      const rows = await database
        .select({ id: businesses.id })
        .from(businesses)
        .where(eq(businesses.orgId, orgId));
      return rows.length;
    },
  };
}

export type OrgRepo = ReturnType<typeof createOrgRepo>;
