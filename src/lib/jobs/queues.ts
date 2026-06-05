/** Background job queue names and payload shapes. */

export const QUEUES = {
  availabilityRequest: "availability-request",
  availabilityReminder: "availability-reminder",
  publishedRoster: "published-roster",
} as const;

/** Sends one staff member their availability magic link. */
export type AvailabilityRequestJob = {
  requestId: string;
  /** Raw magic-link token. Carried transiently; never persisted to our tables. */
  token: string;
};

/** Sweeps a period and reminds anyone who hasn't responded yet. */
export type AvailabilityReminderJob = {
  rosterPeriodId: string;
};

/** Emails one staff member their published shifts for a period. */
export type PublishedRosterJob = {
  rosterPeriodId: string;
  staffMemberId: string;
};
