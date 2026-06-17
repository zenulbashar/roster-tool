/**
 * Owner in-app notifications: pure helpers + a best-effort creation wrapper.
 *
 * Notifications are created at each in-scope event's source (see CLAUDE.md),
 * IN ADDITION to the existing emails. Creation is best-effort: a failure to
 * insert a notification must NEVER break the underlying action (the leave
 * request / stock check / clock / availability reply still succeeds). Creation
 * is also preference-gated — a business that has turned an event type off
 * produces no notification for it.
 *
 * Scope note: OWNER notifications only. The staff analog — per-staff notices
 * on the PIN-gated /me page — is the separate `notifyStaff` mechanism in
 * src/lib/staff-notifications.ts.
 */
import { logger } from "@/lib/logger";
import type { TenantRepo } from "@/lib/tenant/repository";

/** The fixed set of owner notification event types (matches the DB enum). */
export const NOTIFICATION_TYPES = [
  "leave_requested",
  "shift_offer_activity",
  "stock_needs_order",
  "cert_expiring",
  "availability_reply",
  "form_response",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The shape needed to gate creation: the business's per-type preferences. */
export type NotificationPrefs = {
  notifyLeaveRequested: boolean;
  notifyShiftOfferActivity: boolean;
  notifyStockNeedsOrder: boolean;
  notifyCertExpiring: boolean;
  notifyAvailabilityReply: boolean;
  notifyFormResponse: boolean;
};

/**
 * Each event type's preference column on `business` plus the owner-facing label
 * and help text shown in Settings. Single source of truth for the gate and the
 * preferences UI.
 */
export const NOTIFICATION_PREFS: Record<
  NotificationType,
  { column: keyof NotificationPrefs; label: string; description: string }
> = {
  leave_requested: {
    column: "notifyLeaveRequested",
    label: "Leave requests",
    description: "When a staff member requests time off.",
  },
  shift_offer_activity: {
    column: "notifyShiftOfferActivity",
    label: "Shift swaps & open shifts",
    description: "When a shift is offered up or claimed.",
  },
  stock_needs_order: {
    column: "notifyStockNeedsOrder",
    label: "Stock to order",
    description: "When a stock check flags an item to order.",
  },
  cert_expiring: {
    column: "notifyCertExpiring",
    label: "Certification expiry",
    description: "When a certification is expiring or expired.",
  },
  availability_reply: {
    column: "notifyAvailabilityReply",
    label: "Availability replies",
    description: "When a staff member sends their availability.",
  },
  form_response: {
    column: "notifyFormResponse",
    label: "Form responses",
    description: "When someone responds to one of your forms.",
  },
};

/** Whether a business has the given notification type enabled (default on). */
export function prefEnabled(
  prefs: NotificationPrefs,
  type: NotificationType,
): boolean {
  return prefs[NOTIFICATION_PREFS[type].column];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A short relative time for the bell dropdown: "just now", "5 min ago",
 * "3 h ago", "2 d ago", and DD/MM for anything a week or more old. Pure so it
 * can be unit-tested; future timestamps clamp to "just now".
 */
export function relativeTime(from: Date, now: Date = new Date()): string {
  const diff = now.getTime() - from.getTime();
  if (diff < MINUTE_MS) return "just now";
  if (diff < HOUR_MS) {
    const m = Math.floor(diff / MINUTE_MS);
    return `${m} min ago`;
  }
  if (diff < DAY_MS) {
    const h = Math.floor(diff / HOUR_MS);
    return `${h} h ago`;
  }
  if (diff < 7 * DAY_MS) {
    const d = Math.floor(diff / DAY_MS);
    return `${d} d ago`;
  }
  const dd = String(from.getUTCDate()).padStart(2, "0");
  const mm = String(from.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string | null;
  linkPath?: string | null;
};

/**
 * Create an owner notification for the repo's business — best-effort and
 * preference-gated. Reads the business's prefs, skips silently when the type is
 * disabled (or the business is missing), otherwise inserts. ANY error is caught
 * and logged, never thrown, so the caller's action can't be broken by a
 * notification failure.
 */
export async function notifyOwner(
  repo: TenantRepo,
  input: NotifyInput,
): Promise<void> {
  try {
    const business = await repo.getBusiness();
    if (!business) return;
    if (!prefEnabled(business, input.type)) return;
    await repo.createNotification({
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      linkPath: input.linkPath ?? null,
    });
  } catch (err) {
    // Best-effort: a notification must never break the underlying action.
    logger.warn(
      { err, businessId: repo.businessId, type: input.type },
      "Failed to create owner notification; continuing",
    );
  }
}

/**
 * The coalesced "new form response" title — COUNT + form title ONLY. There is
 * deliberately NO answer content and NO respondent identity here (or anywhere in
 * the notification): a count-only line is the SAME for public, attributed and
 * anonymous internal responses, so an anonymous form's notification can never
 * name or imply who submitted. Pure + unit-tested.
 */
export function formResponseTitle(count: number, formTitle: string): string {
  return `${count} new response${count === 1 ? "" : "s"} to ${formTitle}`;
}

/**
 * Notify the OWNER that a form response arrived — best-effort + preference-gated
 * (mirrors `notifyOwner`). Reads the business prefs, skips when
 * `form_response` is off (or the business is missing), otherwise COALESCES into
 * the form's single unread bell row (see `upsertFormResponseNotification`). ANY
 * error is caught and logged, never thrown, so the response submit it follows
 * can never be rolled back or failed by a notification problem.
 *
 * It is passed ONLY `{ formId, formTitle }` — never answers or a respondent —
 * so it is structurally incapable of leaking response content or identity.
 */
export async function notifyFormResponse(
  repo: TenantRepo,
  input: { formId: string; formTitle: string },
): Promise<void> {
  try {
    const business = await repo.getBusiness();
    if (!business) return;
    if (!prefEnabled(business, "form_response")) return;
    await repo.upsertFormResponseNotification(input);
  } catch (err) {
    logger.warn(
      { err, businessId: repo.businessId, type: "form_response" },
      "Failed to create form-response notification; continuing",
    );
  }
}
