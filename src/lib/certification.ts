import type { DateOnly } from "@/lib/time";

/**
 * Pure certification expiry logic — status badges and reminder-stage decisions
 * from an expiry date, today, and a per-business lead time. No DB, no timezone
 * handling: expiry dates are calendar-date strings ("YYYY-MM-DD"), which sort
 * and subtract correctly as UTC midnights. Expiry is FLAGGED only — nothing
 * here enforces anything.
 */

export type CertStatus = "valid" | "expiring" | "expired";

/** Reminder stages, least → most urgent. Null means none sent yet. */
export type ReminderStage = "early" | "final" | "expired";

/** Fixed final-notice threshold (days before expiry), independent of lead time. */
export const FINAL_NOTICE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar days from `today` to `expiry` (negative once expiry has passed). */
export function daysUntil(expiry: DateOnly, today: DateOnly): number {
  const e = Date.parse(`${expiry}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  return Math.round((e - t) / MS_PER_DAY);
}

/**
 * Badge status. Day-of-expiry (and after) counts as EXPIRED, so the badge and
 * the "expired" reminder alert stay aligned.
 */
export function certStatus(
  expiry: DateOnly,
  today: DateOnly,
  leadDays: number,
): CertStatus {
  const days = daysUntil(expiry, today);
  if (days <= 0) return "expired";
  if (days <= leadDays) return "expiring";
  return "valid";
}

const STAGE_RANK: Record<"none" | ReminderStage, number> = {
  none: 0,
  early: 1,
  final: 2,
  expired: 3,
};

/** The stage a cert currently sits in by days-to-expiry, or null if not yet. */
function currentStage(days: number, leadDays: number): ReminderStage | null {
  if (days <= 0) return "expired";
  if (days <= FINAL_NOTICE_DAYS) return "final";
  if (days <= leadDays) return "early";
  return null;
}

/**
 * Which reminder stage (if any) is due now, given the most recent stage already
 * sent (`lastStage`, null = none). A stage is due only when it is MORE urgent
 * than the last one sent — so each stage emails at most once, skipped stages
 * collapse forward (a cert added 5 days out goes straight to `final`), and a
 * cert that's already past expiry sends `expired` once. Returns null when
 * nothing new is due.
 */
export function dueReminderStage(
  expiry: DateOnly,
  today: DateOnly,
  leadDays: number,
  lastStage: ReminderStage | null,
): ReminderStage | null {
  const stage = currentStage(daysUntil(expiry, today), leadDays);
  if (!stage) return null;
  return STAGE_RANK[stage] > STAGE_RANK[lastStage ?? "none"] ? stage : null;
}

/** Friendly phrase for an email/line, e.g. "expires in 7 days". */
export function expiryPhrase(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `expired ${n} day${n === 1 ? "" : "s"} ago`;
  }
  if (days === 0) return "expires today";
  return `expires in ${days} day${days === 1 ? "" : "s"}`;
}
