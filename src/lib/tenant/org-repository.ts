import { and, asc, eq, ne } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  businesses,
  organisations,
  staffMembers,
  staffLocations,
  shiftOffers,
  shifts,
  rosterAssignments,
} from "@/lib/db/schema";
import { claimEligibility } from "@/lib/shift-offer";

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

    /* ----- People (the shared org-wide staff pool) ----- */

    /**
     * Everyone in the org, each with the locations they're an active member of.
     * The person's HOME location is always included (it's an implicit
     * membership — see the tenant repo's `memberHere`). One query per table,
     * grouped in memory (org staffing is small).
     */
    async listPeople() {
      const people = await database
        .select({
          id: staffMembers.id,
          name: staffMembers.name,
          email: staffMembers.email,
          active: staffMembers.active,
          homeBusinessId: staffMembers.businessId,
        })
        .from(staffMembers)
        .where(eq(staffMembers.orgId, orgId))
        .orderBy(asc(staffMembers.name));

      const memberships = await database
        .select({
          staffMemberId: staffLocations.staffMemberId,
          businessId: staffLocations.businessId,
          active: staffLocations.active,
        })
        .from(staffLocations)
        .where(eq(staffLocations.orgId, orgId));

      return people.map((p) => {
        const locationIds = new Set(
          memberships
            .filter((m) => m.staffMemberId === p.id && m.active)
            .map((m) => m.businessId),
        );
        // The home location is always an implicit membership.
        locationIds.add(p.homeBusinessId);
        return { ...p, locationIds: [...locationIds] };
      });
    },

    /** A person, only if they belong to THIS org (IDOR-safe; null otherwise). */
    async getPersonInOrg(staffMemberId: string) {
      const [row] = await database
        .select()
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.id, staffMemberId),
            eq(staffMembers.orgId, orgId),
          ),
        );
      return row ?? null;
    },

    /**
     * Add a person as an active member of a location — the org-level "put this
     * employee at that venue" action. BOTH the person and the location must
     * belong to this org (N3): a foreign id is refused, so a location can never
     * borrow another org's staff. Idempotent (re-activates a soft-removed
     * membership).
     */
    async addPersonToLocation(
      staffMemberId: string,
      businessId: string,
    ): Promise<{ ok: boolean }> {
      const [person] = await database
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.id, staffMemberId),
            eq(staffMembers.orgId, orgId),
          ),
        );
      const [biz] = await database
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.id, businessId), eq(businesses.orgId, orgId)));
      if (!person || !biz) return { ok: false };

      await database
        .insert(staffLocations)
        .values({ orgId, businessId, staffMemberId, active: true })
        .onConflictDoUpdate({
          target: [staffLocations.businessId, staffLocations.staffMemberId],
          set: { active: true },
        });
      return { ok: true };
    },

    /**
     * Remove a person's membership at a location. Refused for the person's HOME
     * location (that's their base — the home disjunct keeps them visible there
     * regardless, so removing the row would be misleading). Org-scoped.
     */
    async removePersonFromLocation(
      staffMemberId: string,
      businessId: string,
    ): Promise<{ ok: boolean; reason?: string }> {
      const [person] = await database
        .select({ homeBusinessId: staffMembers.businessId })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.id, staffMemberId),
            eq(staffMembers.orgId, orgId),
          ),
        );
      if (!person) return { ok: false };
      if (person.homeBusinessId === businessId) {
        return { ok: false, reason: "home" };
      }
      await database
        .delete(staffLocations)
        .where(
          and(
            eq(staffLocations.orgId, orgId),
            eq(staffLocations.businessId, businessId),
            eq(staffLocations.staffMemberId, staffMemberId),
          ),
        );
      return { ok: true };
    },

    /* ----- Cross-location shift cover (M29 Phase 3) ----- */

    /**
     * Open, ORG-scoped offers across the whole org — the "shifts at other
     * locations you can cover" list shown on a staff member's own kiosk/clock.
     * Excludes the viewer's own location (those appear in the normal per-location
     * list) and any offer the viewer released. Joins the originating location's
     * name so the claimer sees where the shift is.
     */
    async listOrgOpenOffers(
      opts: { excludeBusinessId?: string; excludeStaffId?: string } = {},
    ) {
      const rows = await database
        .select({
          offerId: shiftOffers.id,
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          businessId: shiftOffers.businessId,
          locationName: businesses.name,
          offeredByStaffId: shiftOffers.offeredByStaffId,
        })
        .from(shiftOffers)
        .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
        .innerJoin(businesses, eq(shiftOffers.businessId, businesses.id))
        .where(
          and(
            eq(businesses.orgId, orgId),
            eq(shiftOffers.status, "open"),
            eq(shiftOffers.scope, "org"),
            opts.excludeBusinessId
              ? ne(shiftOffers.businessId, opts.excludeBusinessId)
              : undefined,
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
      // Can't claim a shift you offered up yourself.
      return opts.excludeStaffId
        ? rows.filter((r) => r.offeredByStaffId !== opts.excludeStaffId)
        : rows;
    },

    /**
     * A single org-scoped offer with its shift + location detail, validated to
     * belong to THIS org (for the cross-location claim confirmation screen).
     */
    async getOrgOffer(offerId: string) {
      const [row] = await database
        .select({
          offerId: shiftOffers.id,
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          businessId: shiftOffers.businessId,
          locationName: businesses.name,
          status: shiftOffers.status,
          offeredByStaffId: shiftOffers.offeredByStaffId,
        })
        .from(shiftOffers)
        .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
        .innerJoin(businesses, eq(shiftOffers.businessId, businesses.id))
        .where(
          and(
            eq(shiftOffers.id, offerId),
            eq(businesses.orgId, orgId),
            eq(shiftOffers.scope, "org"),
          ),
        );
      return row ?? null;
    },

    /**
     * A staff member (authenticated at their OWN location) claims an org-scoped
     * offer at ANOTHER location. Validates the offer is open + org-scoped + in
     * this org, the claimer is org staff (N3), and the pure `claimEligibility`
     * (not the releaser, not already on the shift). Sets the offer `claimed`;
     * the owner still approves the handover, which grants the membership.
     */
    async claimOrgOffer(offerId: string, claimerStaffId: string) {
      const [offer] = await database
        .select({
          id: shiftOffers.id,
          shiftId: shiftOffers.shiftId,
          status: shiftOffers.status,
          businessId: shiftOffers.businessId,
          offeredByStaffId: shiftOffers.offeredByStaffId,
        })
        .from(shiftOffers)
        .innerJoin(businesses, eq(shiftOffers.businessId, businesses.id))
        .where(
          and(
            eq(shiftOffers.id, offerId),
            eq(businesses.orgId, orgId),
            eq(shiftOffers.scope, "org"),
          ),
        );
      if (!offer) {
        return {
          ok: false as const,
          reason: "This shift isn't available to claim.",
        };
      }
      // N3: the claimer must belong to this org.
      const [claimer] = await database
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.id, claimerStaffId),
            eq(staffMembers.orgId, orgId),
          ),
        );
      if (!claimer) {
        return {
          ok: false as const,
          reason: "This shift isn't available to claim.",
        };
      }
      // Already on this shift? (checked at the offer's own location)
      const [assigned] = await database
        .select({ id: rosterAssignments.id })
        .from(rosterAssignments)
        .where(
          and(
            eq(rosterAssignments.shiftId, offer.shiftId),
            eq(rosterAssignments.staffMemberId, claimerStaffId),
          ),
        );
      const elig = claimEligibility({
        offerStatus: offer.status,
        offeredByStaffId: offer.offeredByStaffId,
        claimerStaffId,
        alreadyAssignedToShift: Boolean(assigned),
      });
      if (!elig.ok) return { ok: false as const, reason: elig.reason };

      const [updated] = await database
        .update(shiftOffers)
        .set({
          status: "claimed",
          claimedByStaffId: claimerStaffId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shiftOffers.id, offerId),
            eq(shiftOffers.status, "open"),
            eq(shiftOffers.scope, "org"),
          ),
        )
        .returning();
      if (!updated) {
        return {
          ok: false as const,
          reason: "This shift was just taken by someone else.",
        };
      }
      return {
        ok: true as const,
        offer: updated,
        businessId: offer.businessId,
        shiftId: offer.shiftId,
      };
    },
  };
}

export type OrgRepo = ReturnType<typeof createOrgRepo>;
