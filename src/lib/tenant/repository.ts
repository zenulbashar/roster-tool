import { and, asc, eq, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  staffMembers,
  shiftTemplates,
  rosterPeriods,
  shifts,
  availabilityRequests,
  availabilityResponses,
  rosterAssignments,
  publishedRosters,
} from "@/lib/db/schema";

/**
 * Tenant-scoped data access.
 *
 * The ONLY way the app should read or write business-owned data. Every method
 * filters by — and forces — the `businessId` captured when the repo is created.
 * Callers pass payloads WITHOUT a `businessId`; it is injected here, so a
 * client-supplied tenant id can never leak in.
 *
 * `businessId` must come from a trusted source (the owner's session, or a
 * validated scoped token), never from request input.
 */
export function createTenantRepo(businessId: string, database: Db = defaultDb) {
  return {
    businessId,

    /* ----- Staff ----- */
    listStaff({ activeOnly = false } = {}) {
      const where = activeOnly
        ? and(
            eq(staffMembers.businessId, businessId),
            eq(staffMembers.active, true),
          )
        : eq(staffMembers.businessId, businessId);
      return database
        .select()
        .from(staffMembers)
        .where(where)
        .orderBy(asc(staffMembers.name));
    },

    getStaff(id: string) {
      return first(
        database
          .select()
          .from(staffMembers)
          .where(
            and(
              eq(staffMembers.id, id),
              eq(staffMembers.businessId, businessId),
            ),
          ),
      );
    },

    async addStaff(input: { name: string; email: string }) {
      const [row] = await database
        .insert(staffMembers)
        .values({ ...input, businessId })
        .returning();
      return row!;
    },

    async updateStaff(
      id: string,
      input: Partial<{ name: string; email: string; active: boolean }>,
    ) {
      const [row] = await database
        .update(staffMembers)
        .set(input)
        .where(
          and(eq(staffMembers.id, id), eq(staffMembers.businessId, businessId)),
        )
        .returning();
      return row ?? null;
    },

    /* ----- Shift templates ----- */
    listTemplates({ activeOnly = false } = {}) {
      const where = activeOnly
        ? and(
            eq(shiftTemplates.businessId, businessId),
            eq(shiftTemplates.active, true),
          )
        : eq(shiftTemplates.businessId, businessId);
      return database
        .select()
        .from(shiftTemplates)
        .where(where)
        .orderBy(asc(shiftTemplates.startTime));
    },

    async addTemplate(input: {
      label: string;
      startTime: string;
      endTime: string;
      weekdays: number[];
    }) {
      const [row] = await database
        .insert(shiftTemplates)
        .values({ ...input, businessId })
        .returning();
      return row!;
    },

    async updateTemplate(
      id: string,
      input: Partial<{
        label: string;
        startTime: string;
        endTime: string;
        weekdays: number[];
        active: boolean;
      }>,
    ) {
      const [row] = await database
        .update(shiftTemplates)
        .set(input)
        .where(
          and(
            eq(shiftTemplates.id, id),
            eq(shiftTemplates.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    /* ----- Roster periods ----- */
    listPeriods() {
      return database
        .select()
        .from(rosterPeriods)
        .where(eq(rosterPeriods.businessId, businessId))
        .orderBy(asc(rosterPeriods.startDate));
    },

    getPeriod(id: string) {
      return first(
        database
          .select()
          .from(rosterPeriods)
          .where(
            and(
              eq(rosterPeriods.id, id),
              eq(rosterPeriods.businessId, businessId),
            ),
          ),
      );
    },

    async createPeriod(input: {
      label: string;
      startDate: string;
      endDate: string;
      availabilityDeadline?: Date | null;
    }) {
      const [row] = await database
        .insert(rosterPeriods)
        .values({ ...input, businessId })
        .returning();
      return row!;
    },

    async updatePeriod(
      id: string,
      input: Partial<{
        label: string;
        startDate: string;
        endDate: string;
        availabilityDeadline: Date | null;
        status: "draft" | "collecting" | "building" | "published";
      }>,
    ) {
      const [row] = await database
        .update(rosterPeriods)
        .set(input)
        .where(
          and(
            eq(rosterPeriods.id, id),
            eq(rosterPeriods.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    /* ----- Shifts ----- */
    listShifts(rosterPeriodId: string) {
      return database
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(shifts.businessId, businessId),
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
    },

    getShift(id: string) {
      return first(
        database
          .select()
          .from(shifts)
          .where(and(eq(shifts.id, id), eq(shifts.businessId, businessId))),
      );
    },

    async createShifts(
      rows: Array<{
        rosterPeriodId: string;
        templateId?: string | null;
        date: string;
        label: string;
        startTime: string;
        endTime: string;
      }>,
    ) {
      if (rows.length === 0) return [];
      return database
        .insert(shifts)
        .values(rows.map((r) => ({ ...r, businessId })))
        .returning();
    },

    async deleteShiftsForPeriod(rosterPeriodId: string) {
      await database
        .delete(shifts)
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(shifts.businessId, businessId),
          ),
        );
    },

    /* ----- Availability requests ----- */
    listRequests(rosterPeriodId: string) {
      return database
        .select()
        .from(availabilityRequests)
        .where(
          and(
            eq(availabilityRequests.rosterPeriodId, rosterPeriodId),
            eq(availabilityRequests.businessId, businessId),
          ),
        );
    },

    async createRequest(input: {
      rosterPeriodId: string;
      staffMemberId: string;
      tokenHash: string;
      expiresAt: Date;
    }) {
      const [row] = await database
        .insert(availabilityRequests)
        .values({ ...input, businessId })
        .returning();
      return row!;
    },

    async markRequestSent(id: string, sentAt: Date = new Date()) {
      const [row] = await database
        .update(availabilityRequests)
        .set({ sentAt })
        .where(
          and(
            eq(availabilityRequests.id, id),
            eq(availabilityRequests.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async markReminderSent(id: string, at: Date = new Date()) {
      const [row] = await database
        .update(availabilityRequests)
        .set({ reminderSentAt: at })
        .where(
          and(
            eq(availabilityRequests.id, id),
            eq(availabilityRequests.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async markRequestResponded(id: string, at: Date = new Date()) {
      const [row] = await database
        .update(availabilityRequests)
        .set({ respondedAt: at })
        .where(
          and(
            eq(availabilityRequests.id, id),
            eq(availabilityRequests.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    /* ----- Availability responses ----- */
    listResponses(rosterPeriodId: string) {
      return database
        .select({
          requestId: availabilityResponses.requestId,
          staffMemberId: availabilityRequests.staffMemberId,
          shiftId: availabilityResponses.shiftId,
          available: availabilityResponses.available,
        })
        .from(availabilityResponses)
        .innerJoin(
          availabilityRequests,
          eq(availabilityResponses.requestId, availabilityRequests.id),
        )
        .where(
          and(
            eq(availabilityRequests.rosterPeriodId, rosterPeriodId),
            eq(availabilityResponses.businessId, businessId),
          ),
        );
    },

    responsesForRequest(requestId: string) {
      return database
        .select({
          shiftId: availabilityResponses.shiftId,
          available: availabilityResponses.available,
        })
        .from(availabilityResponses)
        .where(
          and(
            eq(availabilityResponses.requestId, requestId),
            eq(availabilityResponses.businessId, businessId),
          ),
        );
    },

    /**
     * Replace a staff member's availability for a request. Idempotent: the same
     * submission applied twice yields the same rows. We upsert per shift so a
     * staff member can revise and resubmit.
     */
    async saveResponses(
      requestId: string,
      entries: Array<{ shiftId: string; available: boolean }>,
    ) {
      if (entries.length === 0) return;
      await database
        .insert(availabilityResponses)
        .values(
          entries.map((e) => ({
            requestId,
            shiftId: e.shiftId,
            available: e.available,
            businessId,
          })),
        )
        .onConflictDoUpdate({
          target: [
            availabilityResponses.requestId,
            availabilityResponses.shiftId,
          ],
          set: {
            available: sql`excluded.available`,
            updatedAt: new Date(),
          },
        });
    },

    /* ----- Assignments ----- */
    listAssignments(rosterPeriodId: string) {
      return database
        .select({
          id: rosterAssignments.id,
          shiftId: rosterAssignments.shiftId,
          staffMemberId: rosterAssignments.staffMemberId,
        })
        .from(rosterAssignments)
        .innerJoin(shifts, eq(rosterAssignments.shiftId, shifts.id))
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(rosterAssignments.businessId, businessId),
          ),
        );
    },

    /**
     * Every shift in a period with its assigned staff (if any). One row per
     * shift-assignment; unassigned shifts appear once with null staff. Powers
     * the public roster view and per-staff published emails.
     */
    rosterRows(rosterPeriodId: string) {
      return database
        .select({
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          staffMemberId: rosterAssignments.staffMemberId,
          staffName: staffMembers.name,
        })
        .from(shifts)
        .leftJoin(rosterAssignments, eq(rosterAssignments.shiftId, shifts.id))
        .leftJoin(
          staffMembers,
          eq(staffMembers.id, rosterAssignments.staffMemberId),
        )
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(shifts.businessId, businessId),
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
    },

    async assign(shiftId: string, staffMemberId: string) {
      const [row] = await database
        .insert(rosterAssignments)
        .values({ shiftId, staffMemberId, businessId })
        .onConflictDoNothing({
          target: [rosterAssignments.shiftId, rosterAssignments.staffMemberId],
        })
        .returning();
      return row ?? null;
    },

    async unassign(shiftId: string, staffMemberId: string) {
      await database
        .delete(rosterAssignments)
        .where(
          and(
            eq(rosterAssignments.shiftId, shiftId),
            eq(rosterAssignments.staffMemberId, staffMemberId),
            eq(rosterAssignments.businessId, businessId),
          ),
        );
    },

    /* ----- Published rosters ----- */
    getPublished(rosterPeriodId: string) {
      return first(
        database
          .select()
          .from(publishedRosters)
          .where(
            and(
              eq(publishedRosters.rosterPeriodId, rosterPeriodId),
              eq(publishedRosters.businessId, businessId),
            ),
          ),
      );
    },

    async publish(rosterPeriodId: string, publicSlug: string) {
      const [row] = await database
        .insert(publishedRosters)
        .values({ rosterPeriodId, publicSlug, businessId })
        .onConflictDoUpdate({
          target: publishedRosters.rosterPeriodId,
          set: { publishedAt: new Date() },
        })
        .returning();
      return row!;
    },
  };
}

export type TenantRepo = ReturnType<typeof createTenantRepo>;

/** Run a select expected to return at most one row. */
async function first<T>(query: PromiseLike<T[]>): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}
