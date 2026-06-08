import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  availabilityRequests,
  staffMembers,
  rosterPeriods,
  businesses,
} from "@/lib/db/schema";
import {
  sendEmail,
  availabilityRequestEmail,
  reminderEmail,
  publishedRosterEmail,
} from "@/lib/email";
import { createTenantRepo } from "@/lib/tenant/repository";
import { publishedRosters } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { formatDateTime, formatDateOnly, formatTimeOnly } from "@/lib/time";
import { logger } from "@/lib/logger";
import type {
  AvailabilityRequestJob,
  AvailabilityReminderJob,
  PublishedRosterJob,
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
 * Daily sweep: delete clock-in photos past each business's retention period.
 *
 * Iterates every business and runs its own tenant-scoped sweep, so each
 * business's `photoRetentionDays` is respected and deletions never cross
 * tenants. Only `clock_photo` rows are removed — timesheet entries/hours are
 * kept. Idempotent, so re-running (or a retry) is safe.
 */
export async function handlePhotoRetention(now: Date = new Date()): Promise<void> {
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
