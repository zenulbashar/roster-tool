/** Background job queue names and payload shapes. */

export const QUEUES = {
  availabilityRequest: "availability-request",
  availabilityReminder: "availability-reminder",
  publishedRoster: "published-roster",
  photoRetention: "photo-retention",
  leaveDecision: "leave-decision",
  shiftOfferDecision: "shift-offer-decision",
  certReminder: "cert-reminder",
  orderReminder: "order-reminder",
  staffShiftReminder: "staff-shift-reminder",
  staffLoanExpiry: "staff-loan-expiry",
  formResponseDigest: "form-response-digest",
  dataRetention: "data-retention",
  // PERF-02 / PERF-03: the hourly dispatcher and the per-business sweep it
  // fans out to (one job per tenant per sweep kind per local day).
  sweepDispatch: "sweep-dispatch",
  businessSweep: "business-sweep",
  // OPS-02: where any queue's jobs go once they exhaust their retries.
  deadLetter: "dead-letter",
} as const;

/**
 * Queues that are only ever run by hand now (their daily crons were replaced
 * by the dispatcher): kept registered for one release as the rollback path.
 */
export const LEGACY_SWEEP_QUEUES = [
  QUEUES.photoRetention,
  QUEUES.certReminder,
  QUEUES.orderReminder,
  QUEUES.staffShiftReminder,
  QUEUES.staffLoanExpiry,
  QUEUES.formResponseDigest,
] as const;

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

/**
 * Daily sweep that, per business, emails the owner one consolidated digest of
 * suppliers whose order-by day is today and that have items flagged low /
 * needs-ordering. Cron-scheduled (no payload); idempotent per supplier via
 * `supplier.last_order_reminder_date`.
 */
export type OrderReminderJob = Record<string, never>;

/**
 * Daily sweep that, per business, creates an IN-APP-ONLY shift reminder for
 * each staff member confirmed on tomorrow's published roster. NEVER sends
 * email. Cron-scheduled (no payload); idempotent per staff member per date via
 * `staff_notification.dedupe_key`.
 */
export type StaffShiftReminderJob = Record<string, never>;

/**
 * Daily sweep that ends staff loans whose `end_date` has passed (per the target
 * location's local date), deactivating the loan-created `staff_location`
 * membership unless another active loan still covers it. Cron-scheduled (no
 * payload); idempotent (only acts on `active` loans, flipping them inactive).
 */
export type StaffLoanExpiryJob = Record<string, never>;

/**
 * Daily sweep that, per business, emails the owner one consolidated digest of
 * NEW form responses (counts + titles + links only — never answer content or
 * respondent identity). Cron-scheduled (no payload); idempotent via
 * `business.form_digest_last_at` (cursor advances only after a successful
 * send). Quiet days send nothing.
 */
export type FormResponseDigestJob = Record<string, never>;

/**
 * Daily platform-level retention sweep (PERF-10): applies one explicit
 * policy per table that otherwise only grows — owner notifications, staff
 * notices, the admin audit log, form rate-limit buckets, worker heartbeats,
 * expired Auth.js sessions/verification tokens and consumed SSO token ids.
 * Cron-scheduled (no payload); bounded batches; idempotent. Clock-in photos
 * keep their own per-business `photo-retention` job.
 */
export type DataRetentionJob = Record<string, never>;

/**
 * Hourly dispatcher (PERF-02 / PERF-03): walks every business and enqueues
 * one `BusinessSweepJob` per sweep kind whose local send hour has arrived
 * today and which hasn't been dispatched for that local date yet. Cron-
 * scheduled (no payload); exactly-once via `job_dispatch`.
 */
export type SweepDispatchJob = Record<string, never>;

/**
 * One daily sweep for ONE business (the unit the dispatcher fans out to):
 * `kind` picks the per-business handler; `runDate` is the business-local
 * date the run belongs to. Singleton per (kind, business, runDate). Each
 * handler is idempotent through its own cursor, so a retry is safe.
 */
export type BusinessSweepJob = {
  kind:
    | "certReminder"
    | "orderReminder"
    | "formResponseDigest"
    | "staffShiftReminder"
    | "photoRetention"
    | "staffLoanExpiry";
  businessId: string;
  runDate: string;
};

/**
 * A job that exhausted its retries on ANY queue, moved here by pg-boss
 * (OPS-02). The payload is the original job's data; pg-boss records the
 * source queue on the job row. The handler alerts — it never re-runs the
 * work.
 */
export type DeadLetterJob = Record<string, unknown>;
