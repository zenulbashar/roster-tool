import {
  and,
  asc,
  desc,
  eq,
  ne,
  gte,
  lte,
  lt,
  isNull,
  inArray,
  notExists,
  sql,
} from "drizzle-orm";
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
  leaveRequests,
  shiftOffers,
  staffCertifications,
  suppliers,
  items,
  stockCheckEntries,
  notifications,
  staffNotifications,
  forms,
  formFields,
  formResponses,
  formResponseAnswers,
  type FormFieldOption,
} from "@/lib/db/schema";
import type { NotificationType } from "@/lib/notifications";
import type { StaffNotificationType } from "@/lib/staff-notifications";
import type {
  LeaveType,
  CertTypeInput,
  FormFieldInput,
} from "@/lib/validation";
import type { AnswerRow } from "@/lib/form-submission";
import { generateSlug } from "@/lib/tokens";
import type { StockStatus } from "@/lib/order-reminder";
import type { ReminderStage } from "@/lib/certification";
import type { SetupFlags } from "@/lib/getting-started";
import {
  claimEligibility,
  ACTIVE_OFFER_STATUSES,
  type OfferStatus,
} from "@/lib/shift-offer";
import { alias } from "drizzle-orm/pg-core";
import { photoRetentionCutoff } from "@/lib/retention";

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
        payRateCents: number | null;
        rateType: "flat" | "award";
        rateLabel: string | null;
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

    /**
     * Set (or rotate) the hash of a staff member's private notices link
     * (/me/<token>). Rotating instantly revokes the old link.
     */
    async setStaffNoticesTokenHash(id: string, noticesTokenHash: string) {
      const [row] = await database
        .update(staffMembers)
        .set({ noticesTokenHash })
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
        photoRetentionDays: number;
        kioskTokenHash: string | null;
        latitude: number | null;
        longitude: number | null;
        geofenceRadiusM: number;
        personalClockTokenHash: string | null;
        certReminderLeadDays: number;
        staffShiftRemindersEnabled: boolean;
      }>,
    ) {
      const [row] = await database
        .update(businesses)
        .set(input)
        .where(eq(businesses.id, businessId))
        .returning();
      return row ?? null;
    },

    /**
     * Existence flags for the dashboard "Getting started" checklist — one
     * round trip of scalar EXISTS subqueries off the business row; no domain
     * rows are loaded. Clock-in counts when EITHER capability link (kiosk or
     * personal-phone) has been generated.
     */
    async getSetupFlags(): Promise<SetupFlags> {
      const flags = await first(
        database
          .select({
            hasStaff: sql<boolean>`exists(select 1 from ${staffMembers} where ${staffMembers.businessId} = ${businessId})`,
            hasShiftTemplate: sql<boolean>`exists(select 1 from ${shiftTemplates} where ${shiftTemplates.businessId} = ${businessId})`,
            hasRosterPeriod: sql<boolean>`exists(select 1 from ${rosterPeriods} where ${rosterPeriods.businessId} = ${businessId})`,
            hasClockInLink: sql<boolean>`(${businesses.kioskTokenHash} is not null or ${businesses.personalClockTokenHash} is not null)`,
            hasSupplier: sql<boolean>`exists(select 1 from ${suppliers} where ${suppliers.businessId} = ${businessId})`,
            hasItem: sql<boolean>`exists(select 1 from ${items} where ${items.businessId} = ${businessId})`,
          })
          .from(businesses)
          .where(eq(businesses.id, businessId)),
      );
      return (
        flags ?? {
          hasStaff: false,
          hasShiftTemplate: false,
          hasRosterPeriod: false,
          hasClockInLink: false,
          hasSupplier: false,
          hasItem: false,
        }
      );
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
      opts: {
        shiftId?: string | null;
        at?: Date;
        // Captured only on personal-phone clock-in; null for the kiosk.
        lat?: number | null;
        lng?: number | null;
        withinGeofence?: boolean | null;
      } = {},
    ) {
      const [row] = await database
        .insert(timesheetEntries)
        .values({
          businessId,
          staffMemberId,
          shiftId: opts.shiftId ?? null,
          clockInAt: opts.at ?? new Date(),
          clockInLat: opts.lat ?? null,
          clockInLng: opts.lng ?? null,
          withinGeofence: opts.withinGeofence ?? null,
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
     * Delete this business's clock photos whose parent entry clocked in before
     * the retention cutoff (using the business's own `photoRetentionDays`).
     *
     * Deletes ONLY `clock_photo` rows — the timesheet entries and their hours
     * are kept. Scoped to this business on both tables, so it can never touch
     * another tenant. Idempotent: re-running deletes nothing. Returns the count
     * of photos purged.
     */
    async deleteExpiredPhotos(now: Date = new Date()): Promise<number> {
      const business = await first(
        database
          .select({ retentionDays: businesses.photoRetentionDays })
          .from(businesses)
          .where(eq(businesses.id, businessId)),
      );
      if (!business) return 0;

      const cutoff = photoRetentionCutoff(now, business.retentionDays);
      const expiredEntries = database
        .select({ id: timesheetEntries.id })
        .from(timesheetEntries)
        .where(
          and(
            eq(timesheetEntries.businessId, businessId),
            lt(timesheetEntries.clockInAt, cutoff),
          ),
        );

      const deleted = await database
        .delete(clockPhotos)
        .where(
          and(
            eq(clockPhotos.businessId, businessId),
            inArray(clockPhotos.timesheetEntryId, expiredEntries),
          ),
        )
        .returning({ id: clockPhotos.id });
      return deleted.length;
    },

    /**
     * Timesheet entries whose clock-in falls in [startUtc, endUtc), newest
     * first, each with the staff name and the linked rostered shift (if any).
     * Powers the owner's timesheets view; photos are fetched separately.
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
          withinGeofence: timesheetEntries.withinGeofence,
          shiftId: timesheetEntries.shiftId,
          shiftLabel: shifts.label,
          shiftDate: shifts.date,
          shiftStartTime: shifts.startTime,
          shiftEndTime: shifts.endTime,
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

    /**
     * Approved timesheet entries whose clock-in falls in [startUtc, endUtc),
     * with the staff name/email and pay-rate fields, for the CSV export. Filters
     * to `approved = true`, scoped to this business. Ordered by staff then time.
     */
    listApprovedEntriesForExport(startUtc: Date, endUtc: Date) {
      return database
        .select({
          staffName: staffMembers.name,
          staffEmail: staffMembers.email,
          clockInAt: timesheetEntries.clockInAt,
          clockOutAt: timesheetEntries.clockOutAt,
          withinGeofence: timesheetEntries.withinGeofence,
          payRateCents: staffMembers.payRateCents,
          rateType: staffMembers.rateType,
          rateLabel: staffMembers.rateLabel,
        })
        .from(timesheetEntries)
        .innerJoin(
          staffMembers,
          eq(staffMembers.id, timesheetEntries.staffMemberId),
        )
        .where(
          and(
            eq(timesheetEntries.businessId, businessId),
            eq(timesheetEntries.approved, true),
            gte(timesheetEntries.clockInAt, startUtc),
            lt(timesheetEntries.clockInAt, endUtc),
          ),
        )
        .orderBy(asc(staffMembers.name), asc(timesheetEntries.clockInAt));
    },

    /**
     * Timesheet entries whose clock-in falls in [startUtc, endUtc), with each
     * staff member's name + pay-rate fields and the approval flag, for the
     * hours & labour-cost report. Business-scoped and READ-ONLY; ordered by
     * staff then time. The window bounds are derived/validated server-side —
     * never a client-supplied business_id. Feeds the pure `aggregateLabour`.
     */
    listEntriesForLabourReport(startUtc: Date, endUtc: Date) {
      return database
        .select({
          staffMemberId: timesheetEntries.staffMemberId,
          staffName: staffMembers.name,
          payRateCents: staffMembers.payRateCents,
          rateType: staffMembers.rateType,
          rateLabel: staffMembers.rateLabel,
          clockInAt: timesheetEntries.clockInAt,
          clockOutAt: timesheetEntries.clockOutAt,
          approved: timesheetEntries.approved,
        })
        .from(timesheetEntries)
        .innerJoin(
          staffMembers,
          eq(staffMembers.id, timesheetEntries.staffMemberId),
        )
        .where(
          and(
            eq(timesheetEntries.businessId, businessId),
            gte(timesheetEntries.clockInAt, startUtc),
            lt(timesheetEntries.clockInAt, endUtc),
          ),
        )
        .orderBy(asc(staffMembers.name), asc(timesheetEntries.clockInAt));
    },

    /**
     * Photo metadata (id + kind) for a set of entries, so the owner view can
     * render thumbnails. Bytes are streamed separately via getPhoto.
     */
    listPhotosForEntries(entryIds: string[]) {
      if (entryIds.length === 0)
        return Promise.resolve(
          [] as { id: string; timesheetEntryId: string; kind: "in" | "out" }[],
        );
      return database
        .select({
          id: clockPhotos.id,
          timesheetEntryId: clockPhotos.timesheetEntryId,
          kind: clockPhotos.kind,
        })
        .from(clockPhotos)
        .where(
          and(
            eq(clockPhotos.businessId, businessId),
            inArray(clockPhotos.timesheetEntryId, entryIds),
          ),
        )
        .orderBy(asc(clockPhotos.createdAt));
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

    /* ----- Leave requests ----- */

    /**
     * Create a leave request. Forces this business's id and validates the staff
     * member belongs here first (returns null otherwise), so a foreign or
     * client-supplied staff id can never create a row. Staff submissions pass
     * `status: 'pending'` (the default); owner direct-entry passes `'approved'`
     * with a `decidedAt`.
     */
    async createLeaveRequest(input: {
      staffMemberId: string;
      leaveType: LeaveType;
      startDate: string;
      endDate: string;
      note?: string | null;
      status?: "pending" | "approved" | "denied";
      decidedAt?: Date | null;
    }) {
      const member = await first(
        database
          .select({ id: staffMembers.id })
          .from(staffMembers)
          .where(
            and(
              eq(staffMembers.id, input.staffMemberId),
              eq(staffMembers.businessId, businessId),
            ),
          ),
      );
      if (!member) return null;
      const [row] = await database
        .insert(leaveRequests)
        .values({
          businessId,
          staffMemberId: input.staffMemberId,
          leaveType: input.leaveType,
          startDate: input.startDate,
          endDate: input.endDate,
          note: input.note ?? null,
          status: input.status ?? "pending",
          decidedAt: input.decidedAt ?? null,
        })
        .returning();
      return row ?? null;
    },

    getLeaveRequest(id: string) {
      return first(
        database
          .select()
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.id, id),
              eq(leaveRequests.businessId, businessId),
            ),
          ),
      );
    },

    /** Leave requests of a given status, with the staff member's name. */
    listLeaveByStatus(status: "pending" | "approved" | "denied") {
      return database
        .select({
          id: leaveRequests.id,
          staffMemberId: leaveRequests.staffMemberId,
          staffName: staffMembers.name,
          leaveType: leaveRequests.leaveType,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          note: leaveRequests.note,
          status: leaveRequests.status,
          decidedAt: leaveRequests.decidedAt,
          createdAt: leaveRequests.createdAt,
        })
        .from(leaveRequests)
        .innerJoin(
          staffMembers,
          eq(staffMembers.id, leaveRequests.staffMemberId),
        )
        .where(
          and(
            eq(leaveRequests.businessId, businessId),
            eq(leaveRequests.status, status),
          ),
        )
        .orderBy(asc(leaveRequests.startDate), asc(staffMembers.name));
    },

    /**
     * Approved leave whose range hasn't fully passed as of `fromDate` (a
     * business-local "YYYY-MM-DD"), for the owner's upcoming list. Includes
     * leave currently in progress (end date today or later).
     */
    listUpcomingApprovedLeave(fromDate: string) {
      return database
        .select({
          id: leaveRequests.id,
          staffMemberId: leaveRequests.staffMemberId,
          staffName: staffMembers.name,
          leaveType: leaveRequests.leaveType,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          note: leaveRequests.note,
        })
        .from(leaveRequests)
        .innerJoin(
          staffMembers,
          eq(staffMembers.id, leaveRequests.staffMemberId),
        )
        .where(
          and(
            eq(leaveRequests.businessId, businessId),
            eq(leaveRequests.status, "approved"),
            gte(leaveRequests.endDate, fromDate),
          ),
        )
        .orderBy(asc(leaveRequests.startDate), asc(staffMembers.name));
    },

    /**
     * Approved leave ranges overlapping the inclusive [startDate, endDate]
     * window, scoped to this business. Powers the roster builder's on-leave
     * flag and the draft skip. Overlap = leave starts on/before the window ends
     * AND ends on/after it begins.
     */
    listApprovedLeaveBetween(startDate: string, endDate: string) {
      return database
        .select({
          staffMemberId: leaveRequests.staffMemberId,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
        })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.businessId, businessId),
            eq(leaveRequests.status, "approved"),
            lte(leaveRequests.startDate, endDate),
            gte(leaveRequests.endDate, startDate),
          ),
        );
    },

    /**
     * Approve or deny a still-pending request, stamping `decided_at`. Only acts
     * on a `pending` row (so a double-submit is a no-op and re-deciding can't
     * silently flip a decision). Returns the updated row, or null if it wasn't
     * pending / not found / another tenant's.
     */
    async decideLeaveRequest(
      id: string,
      status: "approved" | "denied",
      decidedAt: Date = new Date(),
    ) {
      const [row] = await database
        .update(leaveRequests)
        .set({ status, decidedAt, updatedAt: new Date() })
        .where(
          and(
            eq(leaveRequests.id, id),
            eq(leaveRequests.businessId, businessId),
            eq(leaveRequests.status, "pending"),
          ),
        )
        .returning();
      return row ?? null;
    },

    /** Mark a request's decision email as sent (idempotency guard). */
    async markLeaveDecisionNotified(id: string, at: Date = new Date()) {
      const [row] = await database
        .update(leaveRequests)
        .set({ decisionNotifiedAt: at })
        .where(
          and(
            eq(leaveRequests.id, id),
            eq(leaveRequests.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async deleteLeaveRequest(id: string) {
      await database
        .delete(leaveRequests)
        .where(
          and(
            eq(leaveRequests.id, id),
            eq(leaveRequests.businessId, businessId),
          ),
        );
    },

    /* ----- Certifications (expiry tracking; flagged, never enforced) ----- */

    /**
     * Certifications for the business with the staff member's name + active
     * flag, soonest expiry first. `activeOnly` (default true) drops certs for
     * deactivated staff — used by both the owner overview and the reminder job.
     */
    listCertifications({ activeOnly = true } = {}) {
      const conds = [eq(staffCertifications.businessId, businessId)];
      if (activeOnly) conds.push(eq(staffMembers.active, true));
      return database
        .select({
          id: staffCertifications.id,
          staffMemberId: staffCertifications.staffMemberId,
          staffName: staffMembers.name,
          staffActive: staffMembers.active,
          certType: staffCertifications.certType,
          certLabel: staffCertifications.certLabel,
          referenceNumber: staffCertifications.referenceNumber,
          expiryDate: staffCertifications.expiryDate,
          lastReminderStage: staffCertifications.lastReminderStage,
        })
        .from(staffCertifications)
        .innerJoin(
          staffMembers,
          eq(staffMembers.id, staffCertifications.staffMemberId),
        )
        .where(and(...conds))
        .orderBy(asc(staffCertifications.expiryDate), asc(staffMembers.name));
    },

    getCertification(id: string) {
      return first(
        database
          .select()
          .from(staffCertifications)
          .where(
            and(
              eq(staffCertifications.id, id),
              eq(staffCertifications.businessId, businessId),
            ),
          ),
      );
    },

    /**
     * Add a certification. Validates the staff member belongs to this business
     * first (returns null otherwise), so a foreign/client-supplied staff id can
     * never create a row. Forces `business_id`; `last_reminder_stage` starts null.
     */
    async addCertification(input: {
      staffMemberId: string;
      certType: CertTypeInput;
      certLabel?: string | null;
      referenceNumber?: string | null;
      expiryDate: string;
    }) {
      const member = await first(
        database
          .select({ id: staffMembers.id })
          .from(staffMembers)
          .where(
            and(
              eq(staffMembers.id, input.staffMemberId),
              eq(staffMembers.businessId, businessId),
            ),
          ),
      );
      if (!member) return null;
      const [row] = await database
        .insert(staffCertifications)
        .values({
          businessId,
          staffMemberId: input.staffMemberId,
          certType: input.certType,
          certLabel: input.certLabel ?? null,
          referenceNumber: input.referenceNumber ?? null,
          expiryDate: input.expiryDate,
        })
        .returning();
      return row ?? null;
    },

    /**
     * Update a certification. When the expiry date changes, the reminder cursor
     * (`last_reminder_stage`) is reset to null so a renewed cert re-arms its
     * reminders. Scoped to this business.
     */
    async updateCertification(
      id: string,
      input: {
        certType: CertTypeInput;
        certLabel?: string | null;
        referenceNumber?: string | null;
        expiryDate: string;
      },
    ) {
      const existing = await this.getCertification(id);
      if (!existing) return null;
      const expiryChanged = existing.expiryDate !== input.expiryDate;
      const [row] = await database
        .update(staffCertifications)
        .set({
          certType: input.certType,
          certLabel: input.certLabel ?? null,
          referenceNumber: input.referenceNumber ?? null,
          expiryDate: input.expiryDate,
          ...(expiryChanged ? { lastReminderStage: null } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(staffCertifications.id, id),
            eq(staffCertifications.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async deleteCertification(id: string) {
      await database
        .delete(staffCertifications)
        .where(
          and(
            eq(staffCertifications.id, id),
            eq(staffCertifications.businessId, businessId),
          ),
        );
    },

    /** Advance a certification's reminder cursor after an email is sent. */
    async updateCertReminderStage(id: string, stage: ReminderStage) {
      const [row] = await database
        .update(staffCertifications)
        .set({ lastReminderStage: stage, updatedAt: new Date() })
        .where(
          and(
            eq(staffCertifications.id, id),
            eq(staffCertifications.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    /* ----- Shift offers (release → claim → owner approves) ----- */

    /**
     * The staff member's own upcoming confirmed shifts in PUBLISHED rosters,
     * each with any active (open/claimed) offer on it. Powers the staff "My
     * shifts" view (release / cancel own offer). `date >= fromDate`.
     */
    listUpcomingShiftsForStaff(staffMemberId: string, fromDate: string) {
      return database
        .select({
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          offerId: shiftOffers.id,
          offerStatus: shiftOffers.status,
          offeredByStaffId: shiftOffers.offeredByStaffId,
        })
        .from(rosterAssignments)
        .innerJoin(shifts, eq(rosterAssignments.shiftId, shifts.id))
        .innerJoin(
          publishedRosters,
          eq(publishedRosters.rosterPeriodId, shifts.rosterPeriodId),
        )
        .leftJoin(
          shiftOffers,
          and(
            eq(shiftOffers.shiftId, shifts.id),
            inArray(shiftOffers.status, [...ACTIVE_OFFER_STATUSES]),
          ),
        )
        .where(
          and(
            eq(rosterAssignments.businessId, businessId),
            eq(rosterAssignments.staffMemberId, staffMemberId),
            eq(rosterAssignments.status, "confirmed"),
            gte(shifts.date, fromDate),
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
    },

    getOffer(id: string) {
      return first(
        database
          .select()
          .from(shiftOffers)
          .where(
            and(eq(shiftOffers.id, id), eq(shiftOffers.businessId, businessId)),
          ),
      );
    },

    /** The active (open/claimed) offer on a shift, if any. */
    getActiveOfferForShift(shiftId: string) {
      return first(
        database
          .select()
          .from(shiftOffers)
          .where(
            and(
              eq(shiftOffers.shiftId, shiftId),
              eq(shiftOffers.businessId, businessId),
              inArray(shiftOffers.status, [...ACTIVE_OFFER_STATUSES]),
            ),
          ),
      );
    },

    /** Shift detail IF it sits in a published period for this business. */
    getPublishedShift(shiftId: string) {
      return first(
        database
          .select({
            id: shifts.id,
            date: shifts.date,
            label: shifts.label,
            startTime: shifts.startTime,
            endTime: shifts.endTime,
          })
          .from(shifts)
          .innerJoin(
            publishedRosters,
            eq(publishedRosters.rosterPeriodId, shifts.rosterPeriodId),
          )
          .where(
            and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)),
          ),
      );
    },

    /** True if the staff member holds a confirmed assignment to the shift. */
    async hasConfirmedAssignment(staffMemberId: string, shiftId: string) {
      const row = await first(
        database
          .select({ id: rosterAssignments.id })
          .from(rosterAssignments)
          .where(
            and(
              eq(rosterAssignments.businessId, businessId),
              eq(rosterAssignments.shiftId, shiftId),
              eq(rosterAssignments.staffMemberId, staffMemberId),
              eq(rosterAssignments.status, "confirmed"),
            ),
          ),
      );
      return row !== null;
    },

    /**
     * A staff member releases a confirmed shift they hold. Creates an `open`
     * offer (offered_by = them). Their assignment is left UNTOUCHED — they stay
     * covered until the owner approves a replacement. Guards: the shift is in a
     * published period, they actually hold it, and there's no active offer
     * already. Returns the offer, or a typed failure.
     */
    async releaseOwnShift(staffMemberId: string, shiftId: string) {
      const shift = await this.getPublishedShift(shiftId);
      if (!shift) {
        return {
          ok: false as const,
          reason: "That shift can't be offered up.",
        };
      }
      if (!(await this.hasConfirmedAssignment(staffMemberId, shiftId))) {
        return {
          ok: false as const,
          reason: "That shift isn't yours to offer.",
        };
      }
      if (await this.getActiveOfferForShift(shiftId)) {
        return {
          ok: false as const,
          reason: "This shift has already been offered up.",
        };
      }
      const [row] = await database
        .insert(shiftOffers)
        .values({ businessId, shiftId, offeredByStaffId: staffMemberId })
        .returning();
      return { ok: true as const, offer: row! };
    },

    /**
     * Owner posts an UNASSIGNED published shift as claimable (offered_by NULL).
     * Guards: published, currently has no confirmed assignee, and no active
     * offer. Returns the offer, or a typed failure.
     */
    async postOpenShift(shiftId: string) {
      const shift = await this.getPublishedShift(shiftId);
      if (!shift) {
        return {
          ok: false as const,
          reason: "Only shifts on a published roster can be opened up.",
        };
      }
      const assigned = await first(
        database
          .select({ id: rosterAssignments.id })
          .from(rosterAssignments)
          .where(
            and(
              eq(rosterAssignments.businessId, businessId),
              eq(rosterAssignments.shiftId, shiftId),
              eq(rosterAssignments.status, "confirmed"),
            ),
          ),
      );
      if (assigned) {
        return {
          ok: false as const,
          reason: "That shift already has someone on it.",
        };
      }
      if (await this.getActiveOfferForShift(shiftId)) {
        return {
          ok: false as const,
          reason: "This shift is already open for claims.",
        };
      }
      const [row] = await database
        .insert(shiftOffers)
        .values({ businessId, shiftId, offeredByStaffId: null })
        .returning();
      return { ok: true as const, offer: row! };
    },

    /** Open offers for the business, with shift detail + releaser name. */
    listOpenOffers() {
      const offeredBy = staffMembers;
      return database
        .select({
          offerId: shiftOffers.id,
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          offeredByStaffId: shiftOffers.offeredByStaffId,
          offeredByName: offeredBy.name,
        })
        .from(shiftOffers)
        .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
        .leftJoin(offeredBy, eq(offeredBy.id, shiftOffers.offeredByStaffId))
        .where(
          and(
            eq(shiftOffers.businessId, businessId),
            eq(shiftOffers.status, "open"),
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
    },

    /**
     * A staff member claims an open offer. Eligibility (pure) blocks claiming a
     * non-open offer, your own released shift, or a shift you're already on.
     * Sets claimed_by + status `claimed` (guarded so two people can't both
     * claim). Returns the claimed offer or a typed failure.
     */
    async claimOffer(offerId: string, claimerStaffId: string) {
      const offer = await this.getOffer(offerId);
      if (!offer) {
        return {
          ok: false as const,
          reason: "That shift is no longer listed.",
        };
      }
      const alreadyAssigned = await this.hasConfirmedAssignment(
        claimerStaffId,
        offer.shiftId,
      );
      const elig = claimEligibility({
        offerStatus: offer.status as OfferStatus,
        offeredByStaffId: offer.offeredByStaffId,
        claimerStaffId,
        alreadyAssignedToShift: alreadyAssigned,
      });
      if (!elig.ok) return { ok: false as const, reason: elig.reason };

      const [row] = await database
        .update(shiftOffers)
        .set({
          claimedByStaffId: claimerStaffId,
          status: "claimed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shiftOffers.id, offerId),
            eq(shiftOffers.businessId, businessId),
            eq(shiftOffers.status, "open"),
          ),
        )
        .returning();
      if (!row) {
        return { ok: false as const, reason: "Someone else just claimed it." };
      }
      return { ok: true as const, offer: row };
    },

    /**
     * Owner approves a claim — THE TRANSFER. In one transaction: re-check the
     * offer is still `claimed` and the shift's roster is still published; assign
     * the claimer as a CONFIRMED assignment; remove the releaser's assignment
     * (only when offered_by was set — the handover); mark the offer `approved`.
     * Never runs if state changed underneath. Returns the offer for emailing.
     */
    async approveOffer(offerId: string) {
      return database.transaction(async (tx) => {
        const [offer] = await tx
          .select()
          .from(shiftOffers)
          .where(
            and(
              eq(shiftOffers.id, offerId),
              eq(shiftOffers.businessId, businessId),
            ),
          );
        if (!offer || offer.status !== "claimed") {
          return {
            ok: false as const,
            reason: "This claim can't be approved.",
          };
        }
        if (!offer.claimedByStaffId) {
          return { ok: false as const, reason: "This claim has no claimer." };
        }
        // Guard: the shift must still be in a published roster.
        const [pub] = await tx
          .select({ id: shifts.id })
          .from(shifts)
          .innerJoin(
            publishedRosters,
            eq(publishedRosters.rosterPeriodId, shifts.rosterPeriodId),
          )
          .where(
            and(
              eq(shifts.id, offer.shiftId),
              eq(shifts.businessId, businessId),
            ),
          );
        if (!pub) {
          return {
            ok: false as const,
            reason: "That roster is no longer published.",
          };
        }

        // Assign the claimer (confirmed). Upsert in case a suggestion exists.
        await tx
          .insert(rosterAssignments)
          .values({
            shiftId: offer.shiftId,
            staffMemberId: offer.claimedByStaffId,
            businessId,
            status: "confirmed",
          })
          .onConflictDoUpdate({
            target: [
              rosterAssignments.shiftId,
              rosterAssignments.staffMemberId,
            ],
            set: { status: "confirmed" },
          });

        // Remove the releaser's assignment (the handover). Owner-posted open
        // shifts have no releaser, so nothing to remove.
        if (offer.offeredByStaffId) {
          await tx
            .delete(rosterAssignments)
            .where(
              and(
                eq(rosterAssignments.shiftId, offer.shiftId),
                eq(rosterAssignments.staffMemberId, offer.offeredByStaffId),
                eq(rosterAssignments.businessId, businessId),
              ),
            );
        }

        const [updated] = await tx
          .update(shiftOffers)
          .set({
            status: "approved",
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(shiftOffers.id, offerId),
              eq(shiftOffers.businessId, businessId),
              eq(shiftOffers.status, "claimed"),
            ),
          )
          .returning();
        return { ok: true as const, offer: updated! };
      });
    },

    /** Owner denies a claim — final, no assignment change. */
    async denyOffer(offerId: string) {
      const [row] = await database
        .update(shiftOffers)
        .set({ status: "denied", decidedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(shiftOffers.id, offerId),
            eq(shiftOffers.businessId, businessId),
            eq(shiftOffers.status, "claimed"),
          ),
        )
        .returning();
      return row ?? null;
    },

    /**
     * Withdraw an OPEN offer (no claimer yet). The owner can withdraw any open
     * offer; pass `byStaffId` for the releaser self-cancelling, which also
     * requires the offer to be theirs. No assignment change.
     */
    async withdrawOffer(offerId: string, opts: { byStaffId?: string } = {}) {
      const conds = [
        eq(shiftOffers.id, offerId),
        eq(shiftOffers.businessId, businessId),
        eq(shiftOffers.status, "open"),
      ];
      if (opts.byStaffId) {
        conds.push(eq(shiftOffers.offeredByStaffId, opts.byStaffId));
      }
      const [row] = await database
        .update(shiftOffers)
        .set({
          status: "withdrawn",
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(...conds))
        .returning();
      return row ?? null;
    },

    /** Pending claims (status `claimed`) for the owner, with names + shift. */
    listPendingClaims() {
      const offeredBy = staffMembers;
      const claimedBy = alias(staffMembers, "claimed_by_staff");
      return database
        .select({
          offerId: shiftOffers.id,
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          offeredByStaffId: shiftOffers.offeredByStaffId,
          offeredByName: offeredBy.name,
          claimedByStaffId: shiftOffers.claimedByStaffId,
          claimedByName: claimedBy.name,
        })
        .from(shiftOffers)
        .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
        .leftJoin(offeredBy, eq(offeredBy.id, shiftOffers.offeredByStaffId))
        .leftJoin(claimedBy, eq(claimedBy.id, shiftOffers.claimedByStaffId))
        .where(
          and(
            eq(shiftOffers.businessId, businessId),
            eq(shiftOffers.status, "claimed"),
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
    },

    /** Active offers on a period's shifts: shiftId → status (+ claimer name). */
    listActiveOffersForPeriod(rosterPeriodId: string) {
      const claimedBy = staffMembers;
      return database
        .select({
          shiftId: shiftOffers.shiftId,
          status: shiftOffers.status,
          claimedByName: claimedBy.name,
        })
        .from(shiftOffers)
        .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
        .leftJoin(claimedBy, eq(claimedBy.id, shiftOffers.claimedByStaffId))
        .where(
          and(
            eq(shiftOffers.businessId, businessId),
            eq(shifts.rosterPeriodId, rosterPeriodId),
            inArray(shiftOffers.status, [...ACTIVE_OFFER_STATUSES]),
          ),
        );
    },

    /**
     * Unassigned shifts in published rosters (no confirmed assignee, no active
     * offer), `date >= fromDate`. Powers the owner "post an open shift" picker.
     */
    listUnassignedPublishedShifts(fromDate: string) {
      return database
        .select({
          shiftId: shifts.id,
          date: shifts.date,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
        })
        .from(shifts)
        .innerJoin(
          publishedRosters,
          eq(publishedRosters.rosterPeriodId, shifts.rosterPeriodId),
        )
        .where(
          and(
            eq(shifts.businessId, businessId),
            gte(shifts.date, fromDate),
            notExists(
              database
                .select({ one: sql`1` })
                .from(rosterAssignments)
                .where(
                  and(
                    eq(rosterAssignments.shiftId, shifts.id),
                    eq(rosterAssignments.status, "confirmed"),
                  ),
                ),
            ),
            notExists(
              database
                .select({ one: sql`1` })
                .from(shiftOffers)
                .where(
                  and(
                    eq(shiftOffers.shiftId, shifts.id),
                    inArray(shiftOffers.status, [...ACTIVE_OFFER_STATUSES]),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(shifts.date), asc(shifts.startTime));
    },

    /** True if the staff member has approved leave covering a calendar date. */
    async hasApprovedLeaveOn(staffMemberId: string, date: string) {
      const row = await first(
        database
          .select({ id: leaveRequests.id })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.businessId, businessId),
              eq(leaveRequests.staffMemberId, staffMemberId),
              eq(leaveRequests.status, "approved"),
              lte(leaveRequests.startDate, date),
              gte(leaveRequests.endDate, date),
            ),
          ),
      );
      return row !== null;
    },

    /**
     * Confirmed shifts (times) the staff member already holds on a date in a
     * published roster, excluding `excludeShiftId`. Used to flag a same-day
     * overlap when someone claims an offer.
     */
    confirmedShiftsForStaffOnDate(
      staffMemberId: string,
      date: string,
      excludeShiftId: string,
    ) {
      return database
        .select({
          shiftId: shifts.id,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
        })
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
            eq(shifts.date, date),
            ne(shifts.id, excludeShiftId),
          ),
        );
    },

    /** Mark an offer's approval email as sent (idempotency guard). */
    async markOfferDecisionNotified(id: string, at: Date = new Date()) {
      const [row] = await database
        .update(shiftOffers)
        .set({ decisionNotifiedAt: at })
        .where(
          and(eq(shiftOffers.id, id), eq(shiftOffers.businessId, businessId)),
        )
        .returning();
      return row ?? null;
    },

    /* ----- Suppliers (inventory Part 1; tracking only) ----- */

    listSuppliers() {
      return database
        .select()
        .from(suppliers)
        .where(eq(suppliers.businessId, businessId))
        .orderBy(asc(suppliers.name));
    },

    getSupplier(id: string) {
      return first(
        database
          .select()
          .from(suppliers)
          .where(
            and(eq(suppliers.id, id), eq(suppliers.businessId, businessId)),
          ),
      );
    },

    /** Suppliers reduced to id + name, for CSV import name-matching. */
    listSuppliersForMatch() {
      return database
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.businessId, businessId))
        .orderBy(asc(suppliers.name));
    },

    async addSupplier(input: {
      name: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      deliveryDays: number[];
      orderCutoffDaysBefore: number;
      notes?: string | null;
    }) {
      const [row] = await database
        .insert(suppliers)
        .values({
          businessId,
          name: input.name,
          contactName: input.contactName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          deliveryDays: input.deliveryDays,
          orderCutoffDaysBefore: input.orderCutoffDaysBefore,
          notes: input.notes ?? null,
        })
        .returning();
      return row!;
    },

    async updateSupplier(
      id: string,
      input: {
        name: string;
        contactName?: string | null;
        email?: string | null;
        phone?: string | null;
        deliveryDays: number[];
        orderCutoffDaysBefore: number;
        notes?: string | null;
      },
    ) {
      const [row] = await database
        .update(suppliers)
        .set({
          name: input.name,
          contactName: input.contactName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          deliveryDays: input.deliveryDays,
          orderCutoffDaysBefore: input.orderCutoffDaysBefore,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(suppliers.id, id), eq(suppliers.businessId, businessId)))
        .returning();
      return row ?? null;
    },

    async deleteSupplier(id: string) {
      await database
        .delete(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.businessId, businessId)));
    },

    /* ----- Items / SKUs (inventory Part 1; tracking only) ----- */

    /**
     * Items for the business with their supplier's name (if linked), name-sorted.
     * `activeOnly` (default false) drops retired items.
     */
    listItems({ activeOnly = false } = {}) {
      const conds = [eq(items.businessId, businessId)];
      if (activeOnly) conds.push(eq(items.isActive, true));
      return database
        .select({
          id: items.id,
          name: items.name,
          skuCode: items.skuCode,
          unit: items.unit,
          supplierId: items.supplierId,
          supplierName: suppliers.name,
          isActive: items.isActive,
        })
        .from(items)
        .leftJoin(suppliers, eq(suppliers.id, items.supplierId))
        .where(and(...conds))
        .orderBy(asc(items.name));
    },

    getItem(id: string) {
      return first(
        database
          .select()
          .from(items)
          .where(and(eq(items.id, id), eq(items.businessId, businessId))),
      );
    },

    /** Item name + sku for dedupe during CSV import (all items, any status). */
    listItemKeysForDedupe() {
      return database
        .select({ name: items.name, skuCode: items.skuCode })
        .from(items)
        .where(eq(items.businessId, businessId));
    },

    /**
     * Resolve a client-supplied supplier id to one that belongs to THIS
     * business, or null. Guards against linking another tenant's supplier.
     */
    async resolveOwnedSupplierId(supplierId: string | null | undefined) {
      if (!supplierId) return null;
      const owned = await this.getSupplier(supplierId);
      return owned ? owned.id : null;
    },

    async addItem(input: {
      name: string;
      skuCode?: string | null;
      unit?: string | null;
      supplierId?: string | null;
    }) {
      const supplierId = await this.resolveOwnedSupplierId(input.supplierId);
      const [row] = await database
        .insert(items)
        .values({
          businessId,
          name: input.name,
          skuCode: input.skuCode ?? null,
          unit: input.unit ?? null,
          supplierId,
        })
        .returning();
      return row!;
    },

    async updateItem(
      id: string,
      input: {
        name: string;
        skuCode?: string | null;
        unit?: string | null;
        supplierId?: string | null;
        isActive?: boolean;
      },
    ) {
      const supplierId = await this.resolveOwnedSupplierId(input.supplierId);
      const [row] = await database
        .update(items)
        .set({
          name: input.name,
          skuCode: input.skuCode ?? null,
          unit: input.unit ?? null,
          supplierId,
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          updatedAt: new Date(),
        })
        .where(and(eq(items.id, id), eq(items.businessId, businessId)))
        .returning();
      return row ?? null;
    },

    async setItemActive(id: string, isActive: boolean) {
      const [row] = await database
        .update(items)
        .set({ isActive, updatedAt: new Date() })
        .where(and(eq(items.id, id), eq(items.businessId, businessId)))
        .returning();
      return row ?? null;
    },

    async deleteItem(id: string) {
      await database
        .delete(items)
        .where(and(eq(items.id, id), eq(items.businessId, businessId)));
    },

    /**
     * Insert many items in one statement, forcing this business's id on every
     * row. Used by the CSV import commit step; supplier ids must already have
     * been resolved against this business (the importer matches by name against
     * `listSuppliersForMatch`). Returns the inserted rows.
     */
    async bulkInsertItems(
      rows: Array<{
        name: string;
        skuCode: string | null;
        unit: string | null;
        supplierId: string | null;
      }>,
    ) {
      if (rows.length === 0) return [];
      return database
        .insert(items)
        .values(rows.map((r) => ({ ...r, businessId })))
        .returning();
    },

    /* ----- Stock checks (inventory Part 2; tracking + reminders only) ----- */

    /**
     * Active items for a stock check, supplier-then-name ordered (the staff
     * check screen and owner Stock view group by supplier). No status here —
     * statuses come from `itemsWithCurrentStatus`.
     */
    listActiveItemsForStockCheck() {
      return database
        .select({
          id: items.id,
          name: items.name,
          unit: items.unit,
          supplierId: items.supplierId,
          supplierName: suppliers.name,
        })
        .from(items)
        .leftJoin(suppliers, eq(suppliers.id, items.supplierId))
        .where(and(eq(items.businessId, businessId), eq(items.isActive, true)))
        .orderBy(asc(suppliers.name), asc(items.name));
    },

    /**
     * Record stock checks for one or more items. Every item id is validated to
     * belong to THIS business AND be active (others are silently dropped, never
     * inserted), and `business_id` is forced — so a foreign or client-supplied
     * item id can never create a row. `checkedByStaffId` is the authenticated
     * staff member (staff flow) or null (owner manual override). Returns the
     * number of entries actually written.
     */
    async recordStockCheck(
      entries: Array<{
        itemId: string;
        status: StockStatus;
        quantity?: string | null;
      }>,
      opts: { checkedByStaffId?: string | null; checkedAt?: Date } = {},
    ): Promise<number> {
      if (entries.length === 0) return 0;
      const ids = [...new Set(entries.map((e) => e.itemId))];
      const owned = await database
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.businessId, businessId),
            eq(items.isActive, true),
            inArray(items.id, ids),
          ),
        );
      const valid = new Set(owned.map((r) => r.id));
      const checkedAt = opts.checkedAt ?? new Date();
      const rows = entries
        .filter((e) => valid.has(e.itemId))
        .map((e) => ({
          businessId,
          itemId: e.itemId,
          status: e.status,
          quantity: e.quantity ?? null,
          checkedByStaffId: opts.checkedByStaffId ?? null,
          checkedAt,
        }));
      if (rows.length === 0) return 0;
      await database.insert(stockCheckEntries).values(rows);
      return rows.length;
    },

    /**
     * Every (active) item with its CURRENT stock status — the most recent
     * `stock_check_entry` per item (latest `checked_at`), or null when never
     * checked. Includes the checker's name (null = owner-set). Powers the owner
     * Stock view and the daily order-reminder job. Scoped to this business.
     */
    itemsWithCurrentStatus() {
      const latest = database
        .selectDistinctOn([stockCheckEntries.itemId], {
          itemId: stockCheckEntries.itemId,
          status: stockCheckEntries.status,
          quantity: stockCheckEntries.quantity,
          checkedAt: stockCheckEntries.checkedAt,
          checkedByStaffId: stockCheckEntries.checkedByStaffId,
        })
        .from(stockCheckEntries)
        .where(eq(stockCheckEntries.businessId, businessId))
        .orderBy(stockCheckEntries.itemId, desc(stockCheckEntries.checkedAt))
        .as("latest");

      const checker = alias(staffMembers, "stock_checker");
      return database
        .select({
          itemId: items.id,
          name: items.name,
          unit: items.unit,
          supplierId: items.supplierId,
          supplierName: suppliers.name,
          status: latest.status,
          quantity: latest.quantity,
          checkedAt: latest.checkedAt,
          checkedByStaffId: latest.checkedByStaffId,
          checkedByName: checker.name,
        })
        .from(items)
        .leftJoin(latest, eq(latest.itemId, items.id))
        .leftJoin(suppliers, eq(suppliers.id, items.supplierId))
        .leftJoin(checker, eq(checker.id, latest.checkedByStaffId))
        .where(and(eq(items.businessId, businessId), eq(items.isActive, true)))
        .orderBy(asc(suppliers.name), asc(items.name));
    },

    /** Suppliers with the fields the order-reminder job needs. */
    listSuppliersForReminder() {
      return database
        .select({
          id: suppliers.id,
          name: suppliers.name,
          deliveryDays: suppliers.deliveryDays,
          orderCutoffDaysBefore: suppliers.orderCutoffDaysBefore,
          lastOrderReminderDate: suppliers.lastOrderReminderDate,
        })
        .from(suppliers)
        .where(eq(suppliers.businessId, businessId));
    },

    /**
     * Advance a supplier's order-reminder cursor to the delivery date just
     * reminded for (idempotency: a re-run the same day is then a no-op, and the
     * next cycle's different date re-arms it). Scoped to this business.
     */
    async markSupplierOrderReminded(supplierId: string, deliveryDate: string) {
      const [row] = await database
        .update(suppliers)
        .set({ lastOrderReminderDate: deliveryDate, updatedAt: new Date() })
        .where(
          and(
            eq(suppliers.id, supplierId),
            eq(suppliers.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
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

    /* ----- Owner in-app notifications ----- */

    /**
     * Insert an owner notification for this business. Prefer `notifyOwner`
     * (best-effort + preference-gated) at call sites; this is the raw insert.
     */
    async createNotification(input: {
      type: NotificationType;
      title: string;
      body?: string | null;
      linkPath?: string | null;
    }) {
      const [row] = await database
        .insert(notifications)
        .values({
          businessId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          linkPath: input.linkPath ?? null,
        })
        .returning();
      return row!;
    },

    /** Recent notifications for the bell/list, newest first. */
    listRecentNotifications(limit = 10) {
      return database
        .select()
        .from(notifications)
        .where(eq(notifications.businessId, businessId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);
    },

    /** Count of unread notifications for the header badge. */
    async countUnreadNotifications(): Promise<number> {
      const [row] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.businessId, businessId),
            eq(notifications.isRead, false),
          ),
        );
      return row?.count ?? 0;
    },

    /** Mark one notification read (tenant-scoped; a foreign id no-ops). */
    async markNotificationRead(id: string) {
      const [row] = await database
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.businessId, businessId),
          ),
        )
        .returning();
      return row ?? null;
    },

    /** Mark every unread notification for this business read. */
    async markAllNotificationsRead() {
      await database
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.businessId, businessId),
            eq(notifications.isRead, false),
          ),
        );
    },

    /** Update per-event notification preferences for this business. */
    async updateNotificationPrefs(
      input: Partial<{
        notifyLeaveRequested: boolean;
        notifyShiftOfferActivity: boolean;
        notifyStockNeedsOrder: boolean;
        notifyCertExpiring: boolean;
        notifyAvailabilityReply: boolean;
      }>,
    ) {
      const [row] = await database
        .update(businesses)
        .set(input)
        .where(eq(businesses.id, businessId))
        .returning();
      return row ?? null;
    },

    /* ----- Staff in-app notifications (notices) ----- */

    /**
     * Insert a staff notice. Prefer `notifyStaff` (best-effort) at call sites;
     * this is the raw insert. A repeated `dedupeKey` is a silent no-op (the
     * unique index + ON CONFLICT DO NOTHING), which is the daily shift
     * reminder's idempotency.
     */
    async createStaffNotification(input: {
      staffMemberId: string;
      type: StaffNotificationType;
      title: string;
      body?: string | null;
      dedupeKey?: string | null;
    }) {
      const [row] = await database
        .insert(staffNotifications)
        .values({
          businessId,
          staffMemberId: input.staffMemberId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          dedupeKey: input.dedupeKey ?? null,
        })
        .onConflictDoNothing({ target: staffNotifications.dedupeKey })
        .returning();
      return row ?? null;
    },

    /** One staff member's notices, newest first. Scoped to business AND staff. */
    listStaffNotifications(staffMemberId: string, limit = 50) {
      return database
        .select()
        .from(staffNotifications)
        .where(
          and(
            eq(staffNotifications.businessId, businessId),
            eq(staffNotifications.staffMemberId, staffMemberId),
          ),
        )
        .orderBy(desc(staffNotifications.createdAt))
        .limit(limit);
    },

    /** Unread count for one staff member. */
    async countUnreadStaffNotifications(
      staffMemberId: string,
    ): Promise<number> {
      const [row] = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(staffNotifications)
        .where(
          and(
            eq(staffNotifications.businessId, businessId),
            eq(staffNotifications.staffMemberId, staffMemberId),
            eq(staffNotifications.isRead, false),
          ),
        );
      return row?.count ?? 0;
    },

    /**
     * Mark one notice read — scoped to business AND the given staff member, so
     * a foreign id (another person's notice, another tenant's) no-ops.
     */
    async markStaffNotificationRead(id: string, staffMemberId: string) {
      const [row] = await database
        .update(staffNotifications)
        .set({ isRead: true })
        .where(
          and(
            eq(staffNotifications.id, id),
            eq(staffNotifications.businessId, businessId),
            eq(staffNotifications.staffMemberId, staffMemberId),
          ),
        )
        .returning();
      return row ?? null;
    },

    /** Mark all of one staff member's unread notices read. */
    async markAllStaffNotificationsRead(staffMemberId: string) {
      await database
        .update(staffNotifications)
        .set({ isRead: true })
        .where(
          and(
            eq(staffNotifications.businessId, businessId),
            eq(staffNotifications.staffMemberId, staffMemberId),
            eq(staffNotifications.isRead, false),
          ),
        );
    },

    /**
     * Confirmed assignments on one calendar date in PUBLISHED periods, with the
     * staff member's active flag — the daily shift reminder's input. Same join
     * shape as `listUpcomingShiftsForStaff` (publishing is what makes a shift
     * real to staff).
     */
    listConfirmedShiftsOnDate(date: string) {
      return database
        .select({
          staffMemberId: rosterAssignments.staffMemberId,
          staffActive: staffMembers.active,
          label: shifts.label,
          startTime: shifts.startTime,
          endTime: shifts.endTime,
          date: shifts.date,
        })
        .from(rosterAssignments)
        .innerJoin(shifts, eq(rosterAssignments.shiftId, shifts.id))
        .innerJoin(
          publishedRosters,
          eq(publishedRosters.rosterPeriodId, shifts.rosterPeriodId),
        )
        .innerJoin(
          staffMembers,
          eq(rosterAssignments.staffMemberId, staffMembers.id),
        )
        .where(
          and(
            eq(rosterAssignments.businessId, businessId),
            eq(rosterAssignments.status, "confirmed"),
            eq(shifts.date, date),
          ),
        )
        .orderBy(asc(shifts.startTime));
    },

    /* ----- Custom forms (form builder; Phase 1a — builder CRUD only) ----- */

    /** This business's forms, newest first, each with its field count. */
    listForms() {
      return database
        .select({
          id: forms.id,
          title: forms.title,
          description: forms.description,
          status: forms.status,
          createdAt: forms.createdAt,
          updatedAt: forms.updatedAt,
          fieldCount: sql<number>`count(${formFields.id})`.mapWith(Number),
        })
        .from(forms)
        .leftJoin(formFields, eq(formFields.formId, forms.id))
        .where(eq(forms.businessId, businessId))
        .groupBy(forms.id)
        .orderBy(desc(forms.createdAt));
    },

    /**
     * One owned form plus its fields (position-ordered), or null when the id
     * isn't this business's — the IDOR guard for the editor and every field op.
     */
    async getFormWithFields(id: string) {
      const form = await first(
        database
          .select()
          .from(forms)
          .where(and(eq(forms.id, id), eq(forms.businessId, businessId))),
      );
      if (!form) return null;
      const fields = await database
        .select()
        .from(formFields)
        .where(
          and(eq(formFields.formId, id), eq(formFields.businessId, businessId)),
        )
        .orderBy(asc(formFields.position));
      return { form, fields };
    },

    /**
     * Create a draft form. A title is always supplied at creation (no
     * placeholder). `business_id` is forced; status/public_slug/allow_anonymous
     * keep their defaults (draft / null / false) — 1a never publishes.
     */
    async createForm(input: { title: string; description?: string | null }) {
      const [row] = await database
        .insert(forms)
        .values({
          businessId,
          title: input.title,
          description: emptyToNull(input.description),
        })
        .returning();
      return row!;
    },

    /** Delete an owned form (its fields cascade). Scoped, so foreign ids no-op. */
    async deleteForm(id: string) {
      await database
        .delete(forms)
        .where(and(eq(forms.id, id), eq(forms.businessId, businessId)));
    },

    /**
     * Transactional whole-form save: update the form meta and reconcile its
     * fields against the incoming ordered array in ONE transaction. Returns the
     * re-read form + fields, or null if the form isn't this business's.
     *
     * Reconcile rules (stated so they can't drift):
     *  - Ownership first: the form must belong to this business (IDOR guard).
     *  - An incoming field whose id matches an OWNED existing field → UPDATE
     *    (scoped by id + form + business).
     *  - Any other incoming field (temp client id, or a forged/foreign id that
     *    isn't owned) → INSERT, **discarding the client id entirely** — the PK
     *    is always DB-generated; the client never picks a primary key.
     *  - Owned fields absent from the incoming array → DELETE.
     *  - `position` is re-sequenced 0..n from array order (never trusted from
     *    the client).
     *  - `business_id` on every insert/update is forced from the session, never
     *    request input, so a field's business always equals its form's business.
     *  - `status` / `public_slug` / `allow_anonymous` are NEVER touched here
     *    (publish/close own those); only `title`/`description`/fields change.
     *  - PUBLISH LOCK: once a form is `published` its FIELD STRUCTURE is frozen
     *    (no add/delete/reorder/type/required/options/label change) — owners
     *    unpublish to edit; republishing keeps the slug. Title/description may
     *    still change. Returns `{ ok:false, reason:"locked" }` on a structural
     *    edit to a published form. This guards the "no editing fields
     *    mid-collection" rule at the data layer, not just the UI.
     *
     * Returns a discriminated result: `{ ok:true, form, fields }`,
     * `{ ok:false, reason:"not_found" }` (not this business's), or
     * `{ ok:false, reason:"locked", message }`.
     */
    async saveForm(
      id: string,
      input: {
        title: string;
        description?: string | null;
        fields: FormFieldInput[];
      },
    ): Promise<SaveFormOutcome> {
      return database.transaction(async (tx) => {
        const [form] = await tx
          .select()
          .from(forms)
          .where(and(eq(forms.id, id), eq(forms.businessId, businessId)));
        if (!form) return { ok: false, reason: "not_found" };

        // Load existing fields in full (ordered) — needed both for the publish
        // lock check and the reconcile below.
        const existingFields = await tx
          .select()
          .from(formFields)
          .where(
            and(
              eq(formFields.formId, id),
              eq(formFields.businessId, businessId),
            ),
          )
          .orderBy(asc(formFields.position));

        // Publish lock: a published form's field structure is frozen.
        if (
          form.status === "published" &&
          !fieldsStructurallyEqual(existingFields, input.fields)
        ) {
          return {
            ok: false,
            reason: "locked",
            message:
              "This form is published. Unpublish it to change its fields.",
          };
        }

        await tx
          .update(forms)
          .set({
            title: input.title,
            description: emptyToNull(input.description),
            updatedAt: new Date(),
          })
          .where(and(eq(forms.id, id), eq(forms.businessId, businessId)));

        // The ONLY ids we will UPDATE by — proven owned, so a forged id can
        // never mutate another form's (or tenant's) field.
        const existingIds = new Set(existingFields.map((r) => r.id));
        const keptIds = new Set<string>();

        for (let position = 0; position < input.fields.length; position++) {
          const field = input.fields[position]!;
          const options = optionsForStorage(field);
          const ownedExisting =
            field.id !== undefined && existingIds.has(field.id);
          if (ownedExisting) {
            keptIds.add(field.id!);
            await tx
              .update(formFields)
              .set({
                businessId,
                formId: id,
                label: field.label,
                type: field.type,
                required: field.required,
                position,
                options,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(formFields.id, field.id!),
                  eq(formFields.formId, id),
                  eq(formFields.businessId, businessId),
                ),
              );
          } else {
            // INSERT: client id (temp or forged) deliberately NOT threaded in —
            // the PK is DB-generated.
            await tx.insert(formFields).values({
              businessId,
              formId: id,
              label: field.label,
              type: field.type,
              required: field.required,
              position,
              options,
            });
          }
        }

        const toDelete = [...existingIds].filter((fid) => !keptIds.has(fid));
        if (toDelete.length > 0) {
          await tx
            .delete(formFields)
            .where(
              and(
                eq(formFields.formId, id),
                eq(formFields.businessId, businessId),
                inArray(formFields.id, toDelete),
              ),
            );
        }

        const [savedForm] = await tx
          .select()
          .from(forms)
          .where(and(eq(forms.id, id), eq(forms.businessId, businessId)));
        const savedFields = await tx
          .select()
          .from(formFields)
          .where(
            and(
              eq(formFields.formId, id),
              eq(formFields.businessId, businessId),
            ),
          )
          .orderBy(asc(formFields.position));
        return { ok: true, form: savedForm!, fields: savedFields };
      });
    },

    /**
     * Publish a form: set status='published' and generate an unguessable
     * `public_slug` only if it has none yet. IDEMPOTENT — re-publishing, or
     * publishing a previously-closed form, KEEPS the existing slug (so printed
     * QR codes/links keep working). Scoped; returns `{ slug }` or null if the
     * form isn't this business's.
     */
    async publishForm(id: string) {
      return database.transaction(async (tx) => {
        const [form] = await tx
          .select()
          .from(forms)
          .where(and(eq(forms.id, id), eq(forms.businessId, businessId)));
        if (!form) return null;
        const slug = form.publicSlug ?? generateSlug();
        const [row] = await tx
          .update(forms)
          .set({ status: "published", publicSlug: slug, updatedAt: new Date() })
          .where(and(eq(forms.id, id), eq(forms.businessId, businessId)))
          .returning();
        return { slug: row!.publicSlug! };
      });
    },

    /**
     * Close a form: status='closed'. The public route then refuses new
     * responses. The slug is KEPT so the owner can re-publish to the same URL.
     * Scoped; returns the row or null.
     */
    async closeForm(id: string) {
      const [row] = await database
        .update(forms)
        .set({ status: "closed", updatedAt: new Date() })
        .where(and(eq(forms.id, id), eq(forms.businessId, businessId)))
        .returning();
      return row ?? null;
    },

    /**
     * Store one PUBLIC response + its answers in a transaction. Re-checks the
     * form is this business's AND still `published` (guards a close/unpublish
     * race) — stores NOTHING and returns null otherwise. `business_id` is forced
     * from the repo on the response and EVERY answer, never request input.
     * Returns the new response id.
     */
    async createPublicResponse(
      formId: string,
      input: {
        channel: "public" | "internal";
        source: string | null;
        answers: AnswerRow[];
      },
    ): Promise<string | null> {
      return database.transaction(async (tx) => {
        const [form] = await tx
          .select({ status: forms.status })
          .from(forms)
          .where(and(eq(forms.id, formId), eq(forms.businessId, businessId)));
        if (!form || form.status !== "published") return null;

        const [response] = await tx
          .insert(formResponses)
          .values({
            businessId,
            formId,
            channel: input.channel,
            source: input.source,
          })
          .returning({ id: formResponses.id });
        const responseId = response!.id;

        if (input.answers.length > 0) {
          await tx.insert(formResponseAnswers).values(
            input.answers.map((a) => ({
              businessId,
              responseId,
              fieldId: a.fieldId,
              fieldLabel: a.fieldLabel,
              fieldType: a.fieldType,
              valueText: a.valueText,
              valueNumber: a.valueNumber,
            })),
          );
        }
        return responseId;
      });
    },

    /**
     * Tenant-scoped read of a form's responses + answers. Used by tests to prove
     * isolation; NO owner UI surfaces this in 1b (the results view is 1c).
     */
    async getResponsesForForm(formId: string) {
      const responses = await database
        .select()
        .from(formResponses)
        .where(
          and(
            eq(formResponses.formId, formId),
            eq(formResponses.businessId, businessId),
          ),
        )
        .orderBy(desc(formResponses.submittedAt));
      if (responses.length === 0) return [];
      const ids = responses.map((r) => r.id);
      const answers = await database
        .select()
        .from(formResponseAnswers)
        .where(
          and(
            inArray(formResponseAnswers.responseId, ids),
            eq(formResponseAnswers.businessId, businessId),
          ),
        );
      return responses.map((r) => ({
        ...r,
        answers: answers.filter((a) => a.responseId === r.id),
      }));
    },
  };
}

/** Result of `saveForm` — see its doc for the publish-lock rule. */
export type SaveFormOutcome =
  | {
      ok: true;
      form: typeof forms.$inferSelect;
      fields: (typeof formFields.$inferSelect)[];
    }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "locked"; message: string };

/**
 * Whether two field arrays are structurally identical (for the publish lock).
 * Compares count, then per position: same field id, label, type, required, and
 * options (length + each option's id and label). A new/added field (no id) or
 * any reorder/type/option change makes them unequal. Label edits also count as
 * a change — a published form's fields are fully frozen.
 */
function fieldsStructurallyEqual(
  existing: (typeof formFields.$inferSelect)[],
  incoming: FormFieldInput[],
): boolean {
  if (existing.length !== incoming.length) return false;
  for (let i = 0; i < existing.length; i++) {
    const a = existing[i]!;
    const b = incoming[i]!;
    if (
      a.id !== b.id ||
      a.label !== b.label ||
      a.type !== b.type ||
      a.required !== b.required
    ) {
      return false;
    }
    const aOpts = a.options ?? [];
    const bOpts = b.type === "single_select" ? b.options : [];
    if (aOpts.length !== bOpts.length) return false;
    for (let j = 0; j < aOpts.length; j++) {
      if (
        aOpts[j]!.id !== bOpts[j]!.id ||
        aOpts[j]!.label !== bOpts[j]!.label
      ) {
        return false;
      }
    }
  }
  return true;
}

export type TenantRepo = ReturnType<typeof createTenantRepo>;

/** Run a select expected to return at most one row. */
async function first<T>(query: PromiseLike<T[]>): Promise<T | null> {
  const rows = await query;
  return rows[0] ?? null;
}

/**
 * What to persist in `form_field.options` for one field. Only `single_select`
 * carries options; every other type stores null. Option id stability (the whole
 * point of `{id,label}`): an option that ARRIVES with an id keeps it; one with
 * no id gets a fresh server-generated id. Existing ids are never regenerated.
 */
function optionsForStorage(field: FormFieldInput): FormFieldOption[] | null {
  if (field.type !== "single_select") return null;
  return field.options.map((o) => ({
    id: o.id ?? crypto.randomUUID(),
    label: o.label,
  }));
}

/** Normalise an optional/empty string to null (e.g. a blank form description). */
function emptyToNull(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}
