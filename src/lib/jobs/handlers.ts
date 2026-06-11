import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  availabilityRequests,
  staffMembers,
  rosterPeriods,
  businesses,
  leaveRequests,
  shiftOffers,
  shifts,
  users,
} from "@/lib/db/schema";
import {
  sendEmail,
  availabilityRequestEmail,
  reminderEmail,
  publishedRosterEmail,
  leaveDecisionEmail,
  shiftClaimApprovedEmail,
  shiftCoveredEmail,
  certificationReminderEmail,
  orderReminderEmail,
} from "@/lib/email";
import { createTenantRepo } from "@/lib/tenant/repository";
import { publishedRosters } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  formatDateTime,
  formatDateOnly,
  formatDateRange,
  formatTimeOnly,
  businessDateOf,
} from "@/lib/time";
import { leaveTypeLabel, certDisplayLabel } from "@/lib/labels";
import { dueReminderStage, daysUntil, expiryPhrase } from "@/lib/certification";
import {
  selectOrderReminders,
  addDays,
  type ItemStatusForReminder,
} from "@/lib/order-reminder";
import { buildShiftReminders } from "@/lib/staff-shift-reminder";
import { logger } from "@/lib/logger";
import { notifyOwner } from "@/lib/notifications";
import type {
  AvailabilityRequestJob,
  AvailabilityReminderJob,
  PublishedRosterJob,
  LeaveDecisionJob,
  ShiftOfferDecisionJob,
} from "./queues";

/** Injectable dependencies so handlers can be tested without sending real mail. */
export type HandlerDeps = {
  send: typeof sendEmail;
};

const defaultDeps: HandlerDeps = { send: sendEmail };

export function magicLink(token: string): string {
  return `${env.APP_URL}/a/${token}`;
}

/**
 * Send a staff member their availability magic link.
 *
 * Idempotent: if the request was already sent (sentAt set) we skip, so a retry
 * or duplicate enqueue won't email twice. We only mark sentAt AFTER a
 * successful send, so a failure mid-way leaves the job to retry.
 */
export async function handleAvailabilityRequest(
  payload: AvailabilityRequestJob,
  deps: HandlerDeps = defaultDeps,
): Promise<void> {
  const [row] = await db
    .select({
      sentAt: availabilityRequests.sentAt,
      staffName: staffMembers.name,
      staffEmail: staffMembers.email,
      periodLabel: rosterPeriods.label,
      deadline: rosterPeriods.availabilityDeadline,
      businessName: businesses.name,
      timezone: businesses.timezone,
    })
    .from(availabilityRequests)
    .innerJoin(
      staffMembers,
      eq(availabilityRequests.staffMemberId, staffMembers.id),
    )
    .innerJoin(
      rosterPeriods,
      eq(availabilityRequests.rosterPeriodId, rosterPeriods.id),
    )
    .innerJoin(businesses, eq(availabilityRequests.businessId, businesses.id))
    .where(eq(availabilityRequests.id, payload.requestId))
    .limit(1);

  if (!row) {
    logger.warn(
      { requestId: payload.requestId },
      "Availability request not found; skipping",
    );
    return;
  }
  if (row.sentAt) {
    logger.info(
      { requestId: payload.requestId },
      "Availability request already sent; skipping",
    );
    return;
  }

  const email = availabilityRequestEmail({
    businessName: row.businessName,
    staffName: row.staffName,
    periodLabel: row.periodLabel,
    link: magicLink(payload.token),
    deadlineText: row.deadline
      ? formatDateTime(row.deadline, row.timezone)
      : undefined,
  });
  email.to = row.staffEmail;

  await deps.send(email);

  await db
    .update(availabilityRequests)
    .set({ sentAt: new Date() })
    .where(eq(availabilityRequests.id, payload.requestId));
}

/**
 * Send a single reminder to a staff member who hasn't replied. Idempotent:
 * skips anyone who has since responded or already been reminded.
 */
export async function handleAvailabilityReminder(
  payload: AvailabilityReminderJob,
  deps: HandlerDeps = defaultDeps,
): Promise<void> {
  const [row] = await db
    .select({
      businessId: availabilityRequests.businessId,
      staffMemberId: availabilityRequests.staffMemberId,
      rosterPeriodId: availabilityRequests.rosterPeriodId,
      respondedAt: availabilityRequests.respondedAt,
      reminderSentAt: availabilityRequests.reminderSentAt,
      staffName: staffMembers.name,
      staffEmail: staffMembers.email,
      periodLabel: rosterPeriods.label,
      deadline: rosterPeriods.availabilityDeadline,
      businessName: businesses.name,
      timezone: businesses.timezone,
    })
    .from(availabilityRequests)
    .innerJoin(
      staffMembers,
      eq(availabilityRequests.staffMemberId, staffMembers.id),
    )
    .innerJoin(
      rosterPeriods,
      eq(availabilityRequests.rosterPeriodId, rosterPeriods.id),
    )
    .innerJoin(businesses, eq(availabilityRequests.businessId, businesses.id))
    .where(eq(availabilityRequests.id, payload.requestId))
    .limit(1);

  if (!row) return;
  if (row.respondedAt || row.reminderSentAt) {
    logger.info(
      { requestId: payload.requestId },
      "Reminder not needed; skipping",
    );
    return;
  }

  // Don't remind anyone the owner has already pre-filled as available — their
  // availability is recorded, even though they never got the original email.
  const repo = createTenantRepo(row.businessId);
  if (await repo.hasManualResponses(row.staffMemberId, row.rosterPeriodId)) {
    logger.info(
      { requestId: payload.requestId },
      "Staff pre-filled; reminder not needed; skipping",
    );
    return;
  }

  const email = reminderEmail({
    businessName: row.businessName,
    staffName: row.staffName,
    periodLabel: row.periodLabel,
    link: magicLink(payload.token),
    deadlineText: row.deadline
      ? formatDateTime(row.deadline, row.timezone)
      : undefined,
  });
  email.to = row.staffEmail;

  await deps.send(email);

  await db
    .update(availabilityRequests)
    .set({ reminderSentAt: new Date() })
    .where(eq(availabilityRequests.id, payload.requestId));
}

/** Email one staff member their published shifts for a period. */
export async function handlePublishedRoster(
  payload: PublishedRosterJob,
  deps: HandlerDeps = defaultDeps,
): Promise<void> {
  const [period] = await db
    .select({
      businessId: rosterPeriods.businessId,
      label: rosterPeriods.label,
      businessName: businesses.name,
    })
    .from(rosterPeriods)
    .innerJoin(businesses, eq(rosterPeriods.businessId, businesses.id))
    .where(eq(rosterPeriods.id, payload.rosterPeriodId))
    .limit(1);
  if (!period) return;

  const repo = createTenantRepo(period.businessId);
  const member = await repo.getStaff(payload.staffMemberId);
  if (!member) return;

  const [published] = await db
    .select({ slug: publishedRosters.publicSlug })
    .from(publishedRosters)
    .where(eq(publishedRosters.rosterPeriodId, payload.rosterPeriodId))
    .limit(1);

  const rows = await repo.rosterRows(payload.rosterPeriodId);
  const mine = rows
    .filter((r) => r.staffMemberId === payload.staffMemberId)
    .map((r) => ({
      dayText: formatDateOnly(r.date),
      label: r.label,
      timeText: `${formatTimeOnly(r.startTime)} – ${formatTimeOnly(r.endTime)}`,
    }));

  const email = publishedRosterEmail({
    businessName: period.businessName,
    staffName: member.name,
    periodLabel: period.label,
    shifts: mine,
    publicUrl: `${env.APP_URL}/r/${published?.slug ?? ""}`,
  });
  email.to = member.email;

  await deps.send(email);
}

/**
 * Email a staff member the owner's decision on their leave request.
 *
 * Idempotent: skips if the request is missing, still pending, or already
 * notified (`decisionNotifiedAt` set), and only stamps `decisionNotifiedAt`
 * AFTER a successful send — so a retry or duplicate enqueue won't email twice,
 * and a failure mid-way leaves the job to retry. The current row's status is the
 * source of truth for which decision to report.
 */
export async function handleLeaveDecision(
  payload: LeaveDecisionJob,
  deps: HandlerDeps = defaultDeps,
): Promise<void> {
  const [row] = await db
    .select({
      status: leaveRequests.status,
      notifiedAt: leaveRequests.decisionNotifiedAt,
      leaveType: leaveRequests.leaveType,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      businessId: leaveRequests.businessId,
      staffName: staffMembers.name,
      staffEmail: staffMembers.email,
      businessName: businesses.name,
    })
    .from(leaveRequests)
    .innerJoin(staffMembers, eq(leaveRequests.staffMemberId, staffMembers.id))
    .innerJoin(businesses, eq(leaveRequests.businessId, businesses.id))
    .where(eq(leaveRequests.id, payload.leaveRequestId))
    .limit(1);

  if (!row) {
    logger.warn(
      { leaveRequestId: payload.leaveRequestId },
      "Leave request not found; skipping decision email",
    );
    return;
  }
  if (row.status === "pending") {
    logger.info(
      { leaveRequestId: payload.leaveRequestId },
      "Leave request still pending; no decision email",
    );
    return;
  }
  if (row.notifiedAt) {
    logger.info(
      { leaveRequestId: payload.leaveRequestId },
      "Leave decision already emailed; skipping",
    );
    return;
  }

  const email = leaveDecisionEmail({
    businessName: row.businessName,
    staffName: row.staffName,
    leaveTypeLabel: leaveTypeLabel(row.leaveType),
    dateRangeText: formatDateRange(row.startDate, row.endDate),
    approved: row.status === "approved",
  });
  email.to = row.staffEmail;

  await deps.send(email);

  await createTenantRepo(row.businessId).markLeaveDecisionNotified(
    payload.leaveRequestId,
  );
}

/**
 * Email the affected staff when the owner approves a shift claim.
 *
 * Sends the claimer a "you're confirmed" email and, when the offer had a
 * releaser, the releaser a "now covered by …" email. Idempotent: skips if the
 * offer is missing, not `approved`, or already notified, and stamps
 * `decision_notified_at` only AFTER sending — so a retry / duplicate enqueue
 * won't email again. (Both recipients are sent before the single flag is set,
 * mirroring leave's idempotency model.)
 */
export async function handleShiftOfferDecision(
  payload: ShiftOfferDecisionJob,
  deps: HandlerDeps = defaultDeps,
): Promise<void> {
  const claimer = alias(staffMembers, "claimer");
  const releaser = alias(staffMembers, "releaser");
  const [row] = await db
    .select({
      status: shiftOffers.status,
      notifiedAt: shiftOffers.decisionNotifiedAt,
      businessId: shiftOffers.businessId,
      offeredByStaffId: shiftOffers.offeredByStaffId,
      date: shifts.date,
      label: shifts.label,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      businessName: businesses.name,
      claimerName: claimer.name,
      claimerEmail: claimer.email,
      releaserName: releaser.name,
      releaserEmail: releaser.email,
    })
    .from(shiftOffers)
    .innerJoin(shifts, eq(shiftOffers.shiftId, shifts.id))
    .innerJoin(businesses, eq(shiftOffers.businessId, businesses.id))
    .innerJoin(claimer, eq(shiftOffers.claimedByStaffId, claimer.id))
    .leftJoin(releaser, eq(shiftOffers.offeredByStaffId, releaser.id))
    .where(eq(shiftOffers.id, payload.shiftOfferId))
    .limit(1);

  if (!row) {
    logger.warn(
      { shiftOfferId: payload.shiftOfferId },
      "Shift offer not found; skipping approval email",
    );
    return;
  }
  if (row.status !== "approved") {
    logger.info(
      { shiftOfferId: payload.shiftOfferId },
      "Shift offer not approved; no email",
    );
    return;
  }
  if (row.notifiedAt) {
    logger.info(
      { shiftOfferId: payload.shiftOfferId },
      "Shift offer approval already emailed; skipping",
    );
    return;
  }

  const dayText = formatDateOnly(row.date);
  const timeText = `${formatTimeOnly(row.startTime)} – ${formatTimeOnly(row.endTime)}`;

  const claimerEmail = shiftClaimApprovedEmail({
    businessName: row.businessName,
    staffName: row.claimerName,
    dayText,
    label: row.label,
    timeText,
  });
  claimerEmail.to = row.claimerEmail;
  await deps.send(claimerEmail);

  // If a staff member released this shift, let them know it's covered.
  if (row.offeredByStaffId && row.releaserEmail && row.releaserName) {
    const coveredEmail = shiftCoveredEmail({
      businessName: row.businessName,
      staffName: row.releaserName,
      coveredByName: row.claimerName,
      dayText,
      label: row.label,
      timeText,
    });
    coveredEmail.to = row.releaserEmail;
    await deps.send(coveredEmail);
  }

  await createTenantRepo(row.businessId).markOfferDecisionNotified(
    payload.shiftOfferId,
  );
}

/**
 * Daily sweep: per business, email the OWNER a digest of certifications that
 * have crossed a reminder threshold (early at the lead time, final at 7 days,
 * or on/after expiry).
 *
 * Idempotent per certification via `last_reminder_stage`: each stage emails at
 * most once, so re-running the same day (or on consecutive days) doesn't resend.
 * The send happens BEFORE advancing the cursor, and cursors are advanced
 * per-business, so a mid-loop failure retries without double-sending earlier
 * businesses. Only active staff's certs are considered. Tenant-scoped per
 * business. Returns the number of reminder lines sent (for tests/logging).
 */
export async function handleCertificationReminders(
  now: Date = new Date(),
  deps: HandlerDeps = defaultDeps,
): Promise<number> {
  const bizRows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      timezone: businesses.timezone,
      leadDays: businesses.certReminderLeadDays,
    })
    .from(businesses);

  let totalSent = 0;
  let businessesEmailed = 0;

  for (const biz of bizRows) {
    const ownerEmails = (
      await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.businessId, biz.id))
    ).map((u) => u.email);
    if (ownerEmails.length === 0) continue;

    const today = businessDateOf(now, biz.timezone);
    const repo = createTenantRepo(biz.id);
    const certs = await repo.listCertifications({ activeOnly: true });

    const due = certs.flatMap((c) => {
      const stage = dueReminderStage(
        c.expiryDate,
        today,
        biz.leadDays,
        c.lastReminderStage,
      );
      return stage ? [{ cert: c, stage }] : [];
    });
    if (due.length === 0) continue;

    const items = due.map(({ cert }) => ({
      staffName: cert.staffName,
      certName: certDisplayLabel(cert.certType, cert.certLabel),
      phrase: expiryPhrase(daysUntil(cert.expiryDate, today)),
      expiryText: formatDateOnly(cert.expiryDate),
    }));

    const email = certificationReminderEmail({
      businessName: biz.name,
      items,
    });
    for (const to of ownerEmails) {
      await deps.send({ ...email, to });
    }

    // Advance cursors only after a successful send.
    for (const { cert, stage } of due) {
      await repo.updateCertReminderStage(cert.id, stage);
    }

    // Best-effort in-app notification mirroring the digest (email unchanged).
    await notifyOwner(repo, {
      type: "cert_expiring",
      title:
        due.length === 1
          ? `${items[0]!.staffName}'s ${items[0]!.certName} ${items[0]!.phrase}`
          : `${due.length} certifications need attention`,
      body:
        due.length === 1
          ? `Expires ${items[0]!.expiryText}`
          : "Some are expiring soon or have expired.",
      linkPath: "/app/certifications",
    });

    totalSent += due.length;
    businessesEmailed += 1;
  }

  logger.info(
    { businessesEmailed, remindersSent: totalSent },
    "Certification reminder sweep complete",
  );
  return totalSent;
}

/**
 * Daily sweep: per business, email the OWNER one consolidated digest of
 * suppliers whose order-by day is today (delivery date == today + cutoff) and
 * that have items flagged `low` / `needs_order` (from the latest stock check).
 *
 * Idempotent per supplier via `last_order_reminder_date`: we only remind once
 * per delivery cycle, advancing the cursor to the delivery date AFTER a
 * successful send — so a re-run the same day is a no-op and the next cycle's
 * different date re-arms it. Cursors advance per-business after that business's
 * single email, so a mid-loop failure retries without double-emailing earlier
 * businesses. Owner-less businesses are skipped. Tenant-scoped per business.
 * Returns the number of supplier reminders sent (for tests/logging).
 */
export async function handleOrderReminders(
  now: Date = new Date(),
  deps: HandlerDeps = defaultDeps,
): Promise<number> {
  const bizRows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      timezone: businesses.timezone,
    })
    .from(businesses);

  let totalSuppliers = 0;
  let businessesEmailed = 0;

  for (const biz of bizRows) {
    const ownerEmails = (
      await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.businessId, biz.id))
    ).map((u) => u.email);
    if (ownerEmails.length === 0) continue;

    const today = businessDateOf(now, biz.timezone);
    const repo = createTenantRepo(biz.id);
    const [suppliers, statuses] = await Promise.all([
      repo.listSuppliersForReminder(),
      repo.itemsWithCurrentStatus(),
    ]);

    const items: ItemStatusForReminder[] = statuses
      .filter((s) => s.status !== null)
      .map((s) => ({
        itemId: s.itemId,
        name: s.name,
        supplierId: s.supplierId,
        status: s.status!,
        quantity: s.quantity,
      }));

    const due = selectOrderReminders(suppliers, items, today);
    if (due.length === 0) continue;

    const email = orderReminderEmail({
      businessName: biz.name,
      suppliers: due.map((d) => ({
        supplierName: d.supplierName,
        deliveryText: formatDateOnly(d.deliveryDate),
        needsOrder: d.needsOrder,
        low: d.low,
      })),
    });
    for (const to of ownerEmails) {
      await deps.send({ ...email, to });
    }

    // Advance cursors only after a successful send.
    for (const d of due) {
      await repo.markSupplierOrderReminded(d.supplierId, d.deliveryDate);
    }
    totalSuppliers += due.length;
    businessesEmailed += 1;
  }

  logger.info(
    { businessesEmailed, suppliersReminded: totalSuppliers },
    "Order reminder sweep complete",
  );
  return totalSuppliers;
}

/**
 * Daily sweep: delete clock-in photos past each business's retention period.
 *
 * Iterates every business and runs its own tenant-scoped sweep, so each
 * business's `photoRetentionDays` is respected and deletions never cross
 * tenants. Only `clock_photo` rows are removed — timesheet entries/hours are
 * kept. Idempotent, so re-running (or a retry) is safe.
 */
export async function handlePhotoRetention(
  now: Date = new Date(),
): Promise<void> {
  const rows = await db.select({ id: businesses.id }).from(businesses);
  let purged = 0;
  for (const { id } of rows) {
    purged += await createTenantRepo(id).deleteExpiredPhotos(now);
  }
  logger.info(
    { businesses: rows.length, photosPurged: purged },
    "Clock-in photo retention sweep complete",
  );
}

/**
 * Daily sweep: per business, create an IN-APP shift reminder for each staff
 * member with a confirmed assignment on TOMORROW's business-local date in a
 * published roster ("you work tomorrow"). One notice per staff member per day.
 *
 * Deliberately sends NO email (it never touches the mailer), so it can't eat
 * into the send limit. Idempotent via the per-staff-per-date dedupe key (a
 * unique index makes a repeat insert a no-op), so re-runs and pg-boss retries
 * are safe; inserts go straight through the repo (NOT best-effort notifyStaff)
 * so a real failure throws and the job retries. Businesses that turned the
 * reminder off are skipped. Returns the number of reminders created.
 */
export async function handleStaffShiftReminders(
  now: Date = new Date(),
): Promise<number> {
  const bizRows = await db
    .select({
      id: businesses.id,
      timezone: businesses.timezone,
      enabled: businesses.staffShiftRemindersEnabled,
    })
    .from(businesses);

  let created = 0;
  for (const biz of bizRows) {
    if (!biz.enabled) continue;
    const tomorrow = addDays(businessDateOf(now, biz.timezone), 1);
    const repo = createTenantRepo(biz.id);
    const rows = await repo.listConfirmedShiftsOnDate(tomorrow);
    for (const reminder of buildShiftReminders(rows, tomorrow)) {
      const inserted = await repo.createStaffNotification({
        staffMemberId: reminder.staffMemberId,
        type: "shift_reminder",
        title: reminder.title,
        body: reminder.body,
        dedupeKey: reminder.dedupeKey,
      });
      if (inserted) created++;
    }
  }
  logger.info(
    { businesses: bizRows.length, remindersCreated: created },
    "Staff shift reminder sweep complete",
  );
  return created;
}
