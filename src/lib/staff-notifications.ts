/**
 * STAFF in-app notifications ("notices"): types + a best-effort creation
 * wrapper. The staff analog of `notifyOwner` (src/lib/notifications.ts), but
 * keyed to one staff member, not the business.
 *
 * Notices are created at each in-scope event's source, IN ADDITION to the
 * existing staff emails (leave decisions, swap approvals) — never a
 * replacement. Creation is best-effort: a failure to insert a notice must
 * NEVER break the underlying action (the leave decision / swap approval /
 * roster publish still succeeds).
 *
 * Staff read their notices on the PIN-gated /me page (per-staff capability
 * link). There is still NO persistent staff session.
 */
import { logger } from "@/lib/logger";
import type { TenantRepo } from "@/lib/tenant/repository";

/** The fixed set of staff notice types (matches the DB enum). */
export const STAFF_NOTIFICATION_TYPES = [
  "leave_decided",
  "shift_swap_approved",
  "rostered",
  "shift_reminder",
] as const;

export type StaffNotificationType = (typeof STAFF_NOTIFICATION_TYPES)[number];

export type NotifyStaffInput = {
  staffMemberId: string;
  type: StaffNotificationType;
  title: string;
  body?: string | null;
  /**
   * Idempotency handle: a unique index on the column makes a repeat insert a
   * no-op (ON CONFLICT DO NOTHING). Used by the daily shift reminder
   * (`shift_reminder:<staffId>:<date>`); event notices leave it null.
   */
  dedupeKey?: string | null;
};

/**
 * Create a staff notice for the repo's business — best-effort. ANY error is
 * caught and logged, never thrown, so the caller's action (a leave decision,
 * swap approval or publish) can't be broken by a notice failure. The
 * staffMemberId must come from the caller's own server context (the decided
 * row / the offer / the assignment list), never from client input.
 */
export async function notifyStaff(
  repo: TenantRepo,
  input: NotifyStaffInput,
): Promise<void> {
  try {
    await repo.createStaffNotification(input);
  } catch (err) {
    // Best-effort: a notice must never break the underlying action.
    logger.warn(
      {
        err,
        businessId: repo.businessId,
        staffMemberId: input.staffMemberId,
        type: input.type,
      },
      "Failed to create staff notice; continuing",
    );
  }
}
