import { and, asc, desc, eq, gte, lt, isNull, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  businesses,
  staffMembers,
  shiftTemplates,
  rosterPeriods,
  shifts,
  availabilityRequests,
  availabilityResponses,
  rosterAssignments,
  publishedRosters,
  timesheetEntries,
  clockPhotos,
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
      input: Partial<{
        name: string;
        email: string;
        active: boolean;
        notifyByDefault: boolean;
      }>,
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

    /** Active staff for the kiosk picker — id + name only, never the PIN hash. */
    listActiveStaffForKiosk() {
      return database
        .select({ id: staffMembers.id, name: staffMembers.name })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.businessId, businessId),
            eq(staffMembers.active, true),
          ),
        )
        .orderBy(asc(staffMembers.name));
    },

    /** Set (or reset) a staff member's PIN and clear any lockout. */
    async setStaffPin(id: string, pinHash: string) {
      const [row] = await database
        .update(staffMembers)
        .set({ pinHash, failedPinAttempts: 0, pinLockedUntil: null })
        .where(
          and(eq(staffMembers.id, id), eq(staffMembers.businessId, businessId)),
        )
        .returning();
      return row ?? null;
    },

    /** Persist the brute-force counter / cooldown for a staff member. */
    async updateStaffLockout(
      id: string,
      state: { failedPinAttempts: number; pinLockedUntil: Date | null },
    ) {
      await database
        .update(staffMembers)
        .set(state)
        .where(
          and(eq(staffMembers.id, id), eq(staffMembers.businessId, businessId)),
        );
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
      // Scope by the response's shift (so request-less manual responses are
      // included too). The staff member is taken from the response directly for
      // manual rows, else derived from the request.
      return database
        .select({
          staffMemberId: sql<string>`coalesce(${availabilityResponses.staffMemberId}, ${availabilityRequests.staffMemberId})`,
          shiftId: availabilityResponses.shiftId,
          available: availabilityResponses.available,
          source: availabilityResponses.source,
        })
        .from(availabilityResponses)
        .innerJoin(shifts, eq(availabilityResponses.shiftId, shifts.id))
        .leftJoin(
          availabilityRequests,
          eq(availabilityResponses.requestId, availabilityRequests.id),
        )
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(availabilityResponses.businessId, businessId),
          ),
        );
    },

    /**
     * Owner pre-fills a staff member as available for every shift in a period,
     * without sending an email or creating a request. Idempotent: re-running
     * leaves the same rows (upsert on the manual partial-unique index).
     * Validates the staff member and period belong to this business first.
     */
    async markAvailableManually(staffMemberId: string, rosterPeriodId: string) {
      const [member, period] = await Promise.all([
        first(
          database
            .select({ id: staffMembers.id })
            .from(staffMembers)
            .where(
              and(
                eq(staffMembers.id, staffMemberId),
                eq(staffMembers.businessId, businessId),
              ),
            ),
        ),
        first(
          database
            .select({ id: rosterPeriods.id })
            .from(rosterPeriods)
            .where(
              and(
                eq(rosterPeriods.id, rosterPeriodId),
                eq(rosterPeriods.businessId, businessId),
              ),
            ),
        ),
      ]);
      if (!member || !period) return 0;

      const periodShifts = await database
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(shifts.businessId, businessId),
          ),
        );
      if (periodShifts.length === 0) return 0;

      await database
        .insert(availabilityResponses)
        .values(
          periodShifts.map((s) => ({
            businessId,
            staffMemberId,
            shiftId: s.id,
            available: true,
            source: "manual" as const,
          })),
        )
        .onConflictDoUpdate({
          target: [
            availabilityResponses.staffMemberId,
            availabilityResponses.shiftId,
          ],
          targetWhere: sql`${availabilityResponses.requestId} is null`,
          set: { available: true, updatedAt: new Date() },
        });
      return periodShifts.length;
    },

    /** True if a staff member has any manual pre-fill response in a period. */
    async hasManualResponses(staffMemberId: string, rosterPeriodId: string) {
      const row = await first(
        database
          .select({ id: availabilityResponses.id })
          .from(availabilityResponses)
          .innerJoin(shifts, eq(availabilityResponses.shiftId, shifts.id))
          .where(
            and(
              eq(availabilityResponses.businessId, businessId),
              eq(availabilityResponses.staffMemberId, staffMemberId),
              eq(availabilityResponses.source, "manual"),
              eq(shifts.rosterPeriodId, rosterPeriodId),
            ),
          ),
      );
      return row !== null;
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
          status: rosterAssignments.status,
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
      return (
        database
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
          // Only confirmed assignments are published — suggested (un-accepted)
          // drafts must never leak into the public roster or staff emails. The
          // status filter lives in the join so unassigned shifts still appear.
          .leftJoin(
            rosterAssignments,
            and(
              eq(rosterAssignments.shiftId, shifts.id),
              eq(rosterAssignments.status, "confirmed"),
            ),
          )
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
          .orderBy(asc(shifts.date), asc(shifts.startTime))
      );
    },

    async assign(shiftId: string, staffMemberId: string) {
      const [row] = await database
        .insert(rosterAssignments)
        .values({ shiftId, staffMemberId, businessId, status: "confirmed" })
        // If a suggestion already exists for this pair, confirm it.
        .onConflictDoUpdate({
          target: [rosterAssignments.shiftId, rosterAssignments.staffMemberId],
          set: { status: "confirmed" },
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

    /**
     * Insert draft ("suggested") assignments produced by "Draft from last
     * week". Never overwrites an existing assignment (confirmed or suggested).
     */
    async createSuggestedAssignments(
      rows: Array<{ shiftId: string; staffMemberId: string }>,
    ) {
      if (rows.length === 0) return [];
      return database
        .insert(rosterAssignments)
        .values(
          rows.map((r) => ({ ...r, businessId, status: "suggested" as const })),
        )
        .onConflictDoNothing({
          target: [rosterAssignments.shiftId, rosterAssignments.staffMemberId],
        })
        .returning();
    },

    /** Confirm a single suggested assignment. */
    async acceptSuggestion(shiftId: string, staffMemberId: string) {
      const [row] = await database
        .update(rosterAssignments)
        .set({ status: "confirmed" })
        .where(
          and(
            eq(rosterAssignments.shiftId, shiftId),
            eq(rosterAssignments.staffMemberId, staffMemberId),
            eq(rosterAssignments.businessId, businessId),
            eq(rosterAssignments.status, "suggested"),
          ),
        )
        .returning();
      return row ?? null;
    },

    /** Confirm every suggested assignment in a period in one go. */
    async acceptAllSuggestions(rosterPeriodId: string) {
      const ids = await database
        .select({ id: rosterAssignments.id })
        .from(rosterAssignments)
        .innerJoin(shifts, eq(rosterAssignments.shiftId, shifts.id))
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(rosterAssignments.businessId, businessId),
            eq(rosterAssignments.status, "suggested"),
          ),
        );
      if (ids.length === 0) return 0;
      await database
        .update(rosterAssignments)
        .set({ status: "confirmed" })
        .where(
          and(
            eq(rosterAssignments.businessId, businessId),
            inArray(
              rosterAssignments.id,
              ids.map((r) => r.id),
            ),
          ),
        );
      return ids.length;
    },

    /** Clear a single suggested assignment (confirmed ones are untouched). */
    async clearSuggestion(shiftId: string, staffMemberId: string) {
      await database
        .delete(rosterAssignments)
        .where(
          and(
            eq(rosterAssignments.shiftId, shiftId),
            eq(rosterAssignments.staffMemberId, staffMemberId),
            eq(rosterAssignments.businessId, businessId),
            eq(rosterAssignments.status, "suggested"),
          ),
        );
    },

    /**
     * The most recently published period for this business, excluding the given
     * one. Used as the template for "Draft from last week".
     */
    getLastPublishedPeriod(excludePeriodId: string) {
      return first(
        database
          .select({
            id: rosterPeriods.id,
            label: rosterPeriods.label,
            startDate: rosterPeriods.startDate,
            endDate: rosterPeriods.endDate,
            publishedAt: publishedRosters.publishedAt,
          })
          .from(publishedRosters)
          .innerJoin(
            rosterPeriods,
            eq(publishedRosters.rosterPeriodId, rosterPeriods.id),
          )
          .where(
            and(
              eq(publishedRosters.businessId, businessId),
              sql`${rosterPeriods.id} <> ${excludePeriodId}`,
            ),
          )
          .orderBy(desc(publishedRosters.publishedAt))
          .limit(1),
      );
    },

    /**
     * Confirmed assignments in a period, each with its shift's identifying
     * attributes (template, label, times, date) so the draft algorithm can
     * match shift types across weeks.
     */
    assignmentsWithShiftType(rosterPeriodId: string) {
      return database
        .select({
          staffMemberId: rosterAssignments.staffMemberId,
          templateId: shifts.templateId,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          date: shifts.date,
        })
        .from(rosterAssignments)
        .innerJoin(shifts, eq(rosterAssignments.shiftId, shifts.id))
        .where(
          and(
            eq(shifts.rosterPeriodId, rosterPeriodId),
            eq(rosterAssignments.businessId, businessId),
            eq(rosterAssignments.status, "confirmed"),
          ),
        );
    },

    /* ----- Business settings ----- */
    getBusiness() {
      return first(
        database.select().from(businesses).where(eq(businesses.id, businessId)),
      );
    },

    async updateBusinessSettings(
      input: Partial<{
        requireClockInPhoto: boolean;
        kioskTokenHash: string | null;
      }>,
    ) {
      const [row] = await database
        .update(businesses)
        .set(input)
        .where(eq(businesses.id, businessId))
        .returning();
      return row ?? null;
    },

    /* ----- Timesheets (clock in/out) ----- */

    /** The staff member's currently-open entry (clocked in), if any. */
    getOpenEntry(staffMemberId: string) {
      return first(
        database
          .select()
          .from(timesheetEntries)
          .where(
            and(
              eq(timesheetEntries.businessId, businessId),
              eq(timesheetEntries.staffMemberId, staffMemberId),
              isNull(timesheetEntries.clockOutAt),
            ),
          ),
      );
    },

    async clockIn(
      staffMemberId: string,
      opts: { shiftId?: string | null; at?: Date } = {},
    ) {
      const [row] = await database
        .insert(timesheetEntries)
        .values({
          businessId,
          staffMemberId,
          shiftId: opts.shiftId ?? null,
          clockInAt: opts.at ?? new Date(),
        })
        .returning();
      return row!;
    },

    async clockOut(entryId: string, at: Date = new Date()) {
      const [row] = await database
        .update(timesheetEntries)
        .set({ clockOutAt: at, updatedAt: new Date() })
        .where(
          and(
            eq(timesheetEntries.id, entryId),
            eq(timesheetEntries.businessId, businessId),
            isNull(timesheetEntries.clockOutAt),
          ),
        )
        .returning();
      return row ?? null;
    },

    async addClockPhoto(input: {
      timesheetEntryId: string;
      kind: "in" | "out";
      mimeType: string;
      imageData: Buffer;
    }) {
      // Guard: the entry must belong to this business before we attach a photo.
      const entry = await first(
        database
          .select({ id: timesheetEntries.id })
          .from(timesheetEntries)
          .where(
            and(
              eq(timesheetEntries.id, input.timesheetEntryId),
              eq(timesheetEntries.businessId, businessId),
            ),
          ),
      );
      if (!entry) return null;
      const [row] = await database
        .insert(clockPhotos)
        .values({ ...input, businessId })
        .returning({ id: clockPhotos.id });
      return row ?? null;
    },

    /** A single clock photo (bytes + mime) scoped to this business. */
    getPhoto(id: string) {
      return first(
        database
          .select({
            mimeType: clockPhotos.mimeType,
            imageData: clockPhotos.imageData,
          })
          .from(clockPhotos)
          .where(
            and(eq(clockPhotos.id, id), eq(clockPhotos.businessId, businessId)),
          ),
      );
    },

    /**
     * Timesheet entries whose clock-in falls in [startUtc, endUtc), newest
     * first, each with the staff name, the linked rostered shift (if any), and
     * whether photos are attached. Powers the owner's timesheets view.
     */
    listEntriesBetween(startUtc: Date, endUtc: Date) {
      return database
        .select({
          id: timesheetEntries.id,
          staffMemberId: timesheetEntries.staffMemberId,
          staffName: staffMembers.name,
          clockInAt: timesheetEntries.clockInAt,
          clockOutAt: timesheetEntries.clockOutAt,
          approved: timesheetEntries.approved,
          shiftId: timesheetEntries.shiftId,
          shiftLabel: shifts.label,
          shiftDate: shifts.date,
          shiftStartTime: shifts.startTime,
          shiftEndTime: shifts.endTime,
          photoCount: sql<number>`(
            select count(*)::int from ${clockPhotos}
            where ${clockPhotos.timesheetEntryId} = ${timesheetEntries.id}
          )`,
        })
        .from(timesheetEntries)
        .innerJoin(
          staffMembers,
          eq(staffMembers.id, timesheetEntries.staffMemberId),
        )
        .leftJoin(shifts, eq(shifts.id, timesheetEntries.shiftId))
        .where(
          and(
            eq(timesheetEntries.businessId, businessId),
            gte(timesheetEntries.clockInAt, startUtc),
            lt(timesheetEntries.clockInAt, endUtc),
          ),
        )
        .orderBy(desc(timesheetEntries.clockInAt));
    },

    getEntry(id: string) {
      return first(
        database
          .select()
          .from(timesheetEntries)
          .where(
            and(
              eq(timesheetEntries.id, id),
              eq(timesheetEntries.businessId, businessId),
            ),
          ),
      );
    },

    async updateEntry(
      id: string,
      input: { clockInAt: Date; clockOutAt: Date | null },
    ) {
      const [row] = await database
        .update(timesheetEntries)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(timesheetEntries.id, id),
            eq(timesheetEntries.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async setEntryApproved(id: string, approved: boolean) {
      const [row] = await database
        .update(timesheetEntries)
        .set({ approved, updatedAt: new Date() })
        .where(
          and(
            eq(timesheetEntries.id, id),
            eq(timesheetEntries.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async deleteEntry(id: string) {
      await database
        .delete(timesheetEntries)
        .where(
          and(
            eq(timesheetEntries.id, id),
            eq(timesheetEntries.businessId, businessId),
          ),
        );
    },

    /**
     * The id of a rostered shift for this staff member on a business-local date
     * — but only from a published period (a confirmed assignment in a period
     * with a published roster). Returns null when there's no scheduled shift;
     * clock-in never requires one, it just links when a match exists.
     */
    async findRosteredShiftForStaffOnDate(
      staffMemberId: string,
      dateStr: string,
    ) {
      const row = await first(
        database
          .select({ shiftId: shifts.id })
          .from(rosterAssignments)
          .innerJoin(shifts, eq(rosterAssignments.shiftId, shifts.id))
          .innerJoin(
            publishedRosters,
            eq(publishedRosters.rosterPeriodId, shifts.rosterPeriodId),
          )
          .where(
            and(
              eq(rosterAssignments.businessId, businessId),
              eq(rosterAssignments.staffMemberId, staffMemberId),
              eq(rosterAssignments.status, "confirmed"),
              eq(shifts.date, dateStr),
            ),
          )
          .orderBy(asc(shifts.startTime))
          .limit(1),
      );
      return row?.shiftId ?? null;
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
