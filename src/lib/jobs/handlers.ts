import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  availabilityRequests,
  staffMembers,
  rosterPeriods,
  businesses,
} from "@/lib/db/schema";
import { sendEmail, availabilityRequestEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { logger } from "@/lib/logger";
import type { AvailabilityRequestJob } from "./queues";

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
