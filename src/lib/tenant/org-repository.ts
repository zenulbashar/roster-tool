import { and, asc, eq, ne, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  businesses,
  organisations,
  staffMembers,
  staffLocations,
  staffLoans,
  shiftOffers,
  shifts,
  rosterAssignments,
} from "@/lib/db/schema";
import { claimEligibility } from "@/lib/shift-offer";
import { appendAuditEventRow, listAuditEventRows } from "@/lib/audit/store";
import type { NewAuditEvent } from "@/lib/audit/events";

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
      const [row] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(businesses)
        .where(eq(businesses.orgId, orgId));
      return row?.count ?? 0;
    },

    /* ----- Audit trail (OPS-04): org-level writes ----- */

    /** Append one event to THIS org's chain (business_id null). */
    appendAuditEvent(input: NewAuditEvent) {
      return appendAuditEventRow(database, { businessId: null, orgId }, input);
    },

    /** Newest first, org-level writes only (locations, people, loans). */
    listAuditEvents(opts?: { limit?: number; offset?: number }) {
      return listAuditEventRows(database, { businessId: null, orgId }, opts);
    },

    /* ----- People (the shared org-wide staff pool) ----- */

    /**
     * Everyone in the org, each with the locations they're an active member of.
     * The person's HOME location is always included (it's an implicit
     * membership — see the tenant repo's `memberHere`). Two queries, grouped in
     * ONE pass over the memberships (PERF-13): O(people + memberships), so a
     * large shared pool costs a Map lookup per person, never a nested scan.
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
        .where(
          and(eq(staffLocations.orgId, orgId), eq(staffLocations.active, true)),
        );

      const byPerson = new Map<string, Set<string>>();
      for (const m of memberships) {
        let set = byPerson.get(m.staffMemberId);
        if (!set) {
          set = new Set();
          byPerson.set(m.staffMemberId, set);
        }
        set.add(m.businessId);
      }
      return people.map((p) => {
        const locationIds = byPerson.get(p.id) ?? new Set<string>();
        // The home location is always an implicit membership.
        locationIds.add(p.homeBusinessId);
        return { ...p, locationIds: [...locationIds] };
      });
    },

    /**
     * People who exist TWICE in this org — the same email (any case) on more
     * than one `staff_member` row (COR-03). Legacy rows whose `org_id` is still
     * null are resolved through their home business, so pre-backfill data is
     * reported too. The owner decides how to resolve each pair (keep one,
     * deactivate the other); nothing is ever merged automatically.
     */
    async listDuplicatePeople(): Promise<
      Array<{
        email: string;
        people: Array<{
          id: string;
          name: string;
          homeBusinessId: string;
          active: boolean;
        }>;
      }>
    > {
      const rows = await database
        .select({
          id: staffMembers.id,
          name: staffMembers.name,
          email: staffMembers.email,
          homeBusinessId: staffMembers.businessId,
          active: staffMembers.active,
        })
        .from(staffMembers)
        .innerJoin(businesses, eq(businesses.id, staffMembers.businessId))
        .where(
          eq(sql`coalesce(${staffMembers.orgId}, ${businesses.orgId})`, orgId),
        )
        .orderBy(asc(staffMembers.createdAt));
      const byEmail = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.email.trim().toLowerCase();
        const list = byEmail.get(key) ?? [];
        list.push(r);
        byEmail.set(key, list);
      }
      return [...byEmail.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([email, list]) => ({
          email,
          people: list.map(({ id, name, homeBusinessId, active }) => ({
            id,
            name,
            homeBusinessId,
            active,
          })),
        }));
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

      // A manual add is a PERMANENT membership: activate it and clear any
      // `loan_id` from a prior loan so the expiry job never removes it.
      await database
        .insert(staffLocations)
        .values({ orgId, businessId, staffMemberId, active: true })
        .onConflictDoUpdate({
          target: [staffLocations.businessId, staffLocations.staffMemberId],
          set: { active: true, loanId: null },
        });
      return { ok: true };
    },

    /**
     * Remove a person's membership at a location. Refused for the person's HOME
     * location (that's their base — the home disjunct keeps them visible there
     * regardless, so removing the row would be misleading). Org-scoped.
     *
     * A DEACTIVATION, not a delete (COR-07): the row flips `active = false`
     * (and drops any `loan_id`), the same model the loan machinery uses, and
     * any active loan of this person TO this location is ended in the same
     * transaction — so the People page never shows "on loan to X" for someone
     * who is no longer a member there, and a later `addPersonToLocation` or
     * loan simply re-activates the row.
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
      await database.transaction(async (tx) => {
        await tx
          .update(staffLocations)
          .set({ active: false, loanId: null })
          .where(
            and(
              eq(staffLocations.orgId, orgId),
              eq(staffLocations.businessId, businessId),
              eq(staffLocations.staffMemberId, staffMemberId),
            ),
          );
        await tx
          .update(staffLoans)
          .set({ active: false })
          .where(
            and(
              eq(staffLoans.orgId, orgId),
              eq(staffLoans.staffMemberId, staffMemberId),
              eq(staffLoans.toBusinessId, businessId),
              eq(staffLoans.active, true),
            ),
          );
      });
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

    /* ----- Staff loans (M29 Phase 4 — date-ranged lend) ----- */

    /**
     * Lend a person to a location for a date range: records the loan AND ensures
     * an active `staff_location` at the target so they're rosterable there for
     * the window. N3: person + target must belong to this org, and you can't
     * lend someone to their own home. A freshly-created (or re-activated)
     * membership is tagged with the loan id so the expiry job / end action only
     * ever removes loan-created memberships — a permanent one is left alone.
     */
    async createLoan(input: {
      staffMemberId: string;
      toBusinessId: string;
      startDate: string;
      endDate: string;
      note?: string | null;
    }): Promise<{ ok: boolean; reason?: string }> {
      if (input.endDate < input.startDate) {
        return { ok: false, reason: "dates" };
      }
      const [person] = await database
        .select({ homeBusinessId: staffMembers.businessId })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.id, input.staffMemberId),
            eq(staffMembers.orgId, orgId),
          ),
        );
      const [biz] = await database
        .select({ id: businesses.id })
        .from(businesses)
        .where(
          and(
            eq(businesses.id, input.toBusinessId),
            eq(businesses.orgId, orgId),
          ),
        );
      if (!person || !biz) return { ok: false, reason: "not_found" };
      if (person.homeBusinessId === input.toBusinessId) {
        return { ok: false, reason: "home" };
      }

      return database.transaction(async (tx) => {
        const [loan] = await tx
          .insert(staffLoans)
          .values({
            orgId,
            staffMemberId: input.staffMemberId,
            fromBusinessId: person.homeBusinessId,
            toBusinessId: input.toBusinessId,
            startDate: input.startDate,
            endDate: input.endDate,
            note: input.note ?? null,
          })
          .returning({ id: staffLoans.id });

        const [existing] = await tx
          .select({ id: staffLocations.id, active: staffLocations.active })
          .from(staffLocations)
          .where(
            and(
              eq(staffLocations.businessId, input.toBusinessId),
              eq(staffLocations.staffMemberId, input.staffMemberId),
            ),
          );
        if (!existing) {
          // No membership yet → create one, tagged with the loan.
          await tx.insert(staffLocations).values({
            orgId,
            businessId: input.toBusinessId,
            staffMemberId: input.staffMemberId,
            active: true,
            loanId: loan!.id,
          });
        } else if (!existing.active) {
          // Re-activate an inactive membership and mark it loan-created.
          await tx
            .update(staffLocations)
            .set({ active: true, loanId: loan!.id })
            .where(eq(staffLocations.id, existing.id));
        }
        // An already-active membership is left untouched (permanent or covered
        // by another loan) — the loan is still recorded.
        return { ok: true };
      });
    },

    /**
     * Active (not-yet-ended) loans — upcoming or in-window — with the person's
     * name and the from/to location names, soonest start first. Ended loans are
     * flipped to `active = false` by the expiry job, so this is the live list.
     */
    async listLoans() {
      const fromBiz = alias(businesses, "from_biz");
      const toBiz = alias(businesses, "to_biz");
      return database
        .select({
          id: staffLoans.id,
          staffMemberId: staffLoans.staffMemberId,
          staffName: staffMembers.name,
          fromBusinessId: staffLoans.fromBusinessId,
          fromName: fromBiz.name,
          toBusinessId: staffLoans.toBusinessId,
          toName: toBiz.name,
          startDate: staffLoans.startDate,
          endDate: staffLoans.endDate,
          note: staffLoans.note,
        })
        .from(staffLoans)
        .innerJoin(staffMembers, eq(staffMembers.id, staffLoans.staffMemberId))
        .innerJoin(fromBiz, eq(fromBiz.id, staffLoans.fromBusinessId))
        .innerJoin(toBiz, eq(toBiz.id, staffLoans.toBusinessId))
        .where(and(eq(staffLoans.orgId, orgId), eq(staffLoans.active, true)))
        .orderBy(asc(staffLoans.startDate));
    },

    /**
     * Which of a set of people are currently on an active loan somewhere, and to
     * where — for "on loan" markers on the People page. Keyed by staff id.
     */
    async loansForMarkers() {
      const toBiz = alias(businesses, "to_biz");
      return database
        .select({
          staffMemberId: staffLoans.staffMemberId,
          toName: toBiz.name,
          startDate: staffLoans.startDate,
          endDate: staffLoans.endDate,
        })
        .from(staffLoans)
        .innerJoin(toBiz, eq(toBiz.id, staffLoans.toBusinessId))
        .where(and(eq(staffLoans.orgId, orgId), eq(staffLoans.active, true)));
    },

    /**
     * End a loan now: flips it inactive and — unless another active loan still
     * covers the same person at the same location — deactivates the loan-created
     * membership (never a permanent one, guarded by `loan_id IS NOT NULL`).
     */
    async endLoan(loanId: string): Promise<{ ok: boolean }> {
      return database.transaction(async (tx) => {
        const [loan] = await tx
          .select()
          .from(staffLoans)
          .where(and(eq(staffLoans.id, loanId), eq(staffLoans.orgId, orgId)));
        if (!loan) return { ok: false };

        const [otherActive] = await tx
          .select({ id: staffLoans.id })
          .from(staffLoans)
          .where(
            and(
              eq(staffLoans.orgId, orgId),
              eq(staffLoans.staffMemberId, loan.staffMemberId),
              eq(staffLoans.toBusinessId, loan.toBusinessId),
              eq(staffLoans.active, true),
              ne(staffLoans.id, loanId),
            ),
          );
        if (!otherActive) {
          await tx
            .update(staffLocations)
            .set({ active: false })
            .where(
              and(
                eq(staffLocations.businessId, loan.toBusinessId),
                eq(staffLocations.staffMemberId, loan.staffMemberId),
                isNotNull(staffLocations.loanId),
              ),
            );
        }
        await tx
          .update(staffLoans)
          .set({ active: false })
          .where(eq(staffLoans.id, loanId));
        return { ok: true };
      });
    },
  };
}

export type OrgRepo = ReturnType<typeof createOrgRepo>;
