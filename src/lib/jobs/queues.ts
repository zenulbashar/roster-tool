/** Background job queue names and payload shapes. */

export const QUEUES = {
  availabilityRequest: "availability-request",
  availabilityReminder: "availability-reminder",
  publishedRoster: "published-roster",
  photoRetention: "photo-retention",
  leaveDecision: "leave-decision",
  shiftOfferDecision: "shift-offer-decision",
  certReminder: "cert-reminder",
} as const;

/** Sends one staff member their availability magic link. */
export type AvailabilityRequestJob = {
  requestId: string;
  /** Raw magic-link token. Carried transiently; never persisted to our tables. */
  token: string;
};

/**
 * Reminds one staff member who hasn't responded yet. Scheduled for shortly
 * before the deadline and carries the same token as the original request.
 */
export type AvailabilityReminderJob = {
  requestId: string;
  token: string;
};

/** Emails one staff member their published shifts for a period. */
export type PublishedRosterJob = {
  rosterPeriodId: string;
  staffMemberId: string;
};

/**
 * Daily sweep that purges clock-in photos past each business's retention
 * period. Cron-scheduled (no payload); see CLAUDE.md "Clock-in photos".
 */
export type PhotoRetentionJob = Record<string, never>;

/**
 * Emails the affected staff member that their leave request was approved or
 * denied. Enqueued when the owner decides; idempotent via the request's
 * `decision_notified_at`.
 */
export type LeaveDecisionJob = {
  leaveRequestId: string;
};

/**
 * Emails the affected staff when the owner approves a shift claim: the claimer
 * ("you're confirmed") and, if there was a releaser, the releaser ("now
 * covered by …"). Enqueued on approval only; idempotent via the offer's
 * `decision_notified_at`.
 */
export type ShiftOfferDecisionJob = {
  shiftOfferId: string;
};

/**
 * Daily sweep that, per business, emails the owner a digest of certifications
 * crossing a reminder threshold (early / final / on-expiry). Cron-scheduled (no
 * payload); idempotent per cert via `last_reminder_stage`.
 */
export type CertReminderJob = Record<string, never>;
