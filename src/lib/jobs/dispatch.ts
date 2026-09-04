import { businessDateOf, type DateOnly } from "@/lib/time";

/**
 * Daily-sweep dispatch (PERF-02 / PERF-03) — PURE.
 *
 * The six daily sweeps used to be six global UTC crons, each a serial loop
 * over every business: no partitioning (one failure retried the whole sweep),
 * a hard ceiling in the low thousands of locations, and a trigger time fixed
 * to Sydney regardless of the location's own timezone. Now an HOURLY
 * dispatcher walks the businesses and enqueues ONE job per business per sweep
 * kind per local day — when that location's LOCAL clock has reached the hour
 * it wants that sweep at. Failures are isolated to a tenant, retries are per
 * tenant, load spreads across 24 windows, and a Perth, London or Los Angeles
 * venue gets its digest in its own morning.
 *
 * Send hours are per LOCATION: `business.digest_hour_local` (owner digests —
 * certifications, orders, form responses; default 7) and
 * `business.reminder_hour_local` (the staff "you work tomorrow" notice;
 * default 17). Maintenance sweeps (photo retention, loan expiry) run at a fixed
 * quiet local hour. The dispatcher enqueues once the local hour is AT OR PAST
 * the target (never "exactly", so a DST-skipped hour or a late dispatcher run
 * still fires that day); the `job_dispatch` row per (kind, business, local
 * date) is what makes it exactly once.
 */

export const SWEEP_KINDS = [
  "certReminder",
  "orderReminder",
  "formResponseDigest",
  "staffShiftReminder",
  "photoRetention",
  "staffLoanExpiry",
] as const;

export type SweepKind = (typeof SWEEP_KINDS)[number];

/** Which configured hour each sweep follows. */
export type SweepSchedule =
  | { hour: "digest" }
  | { hour: "reminder" }
  | { hour: "fixed"; localHour: number };

export const SWEEP_SCHEDULE: Record<SweepKind, SweepSchedule> = {
  certReminder: { hour: "digest" },
  orderReminder: { hour: "digest" },
  formResponseDigest: { hour: "digest" },
  staffShiftReminder: { hour: "reminder" },
  // Quiet-hour maintenance, business-local.
  photoRetention: { hour: "fixed", localHour: 3 },
  staffLoanExpiry: { hour: "fixed", localHour: 1 },
};

/** Column defaults — reproduce the Sydney behaviour for existing tenants. */
export const DEFAULT_DIGEST_HOUR_LOCAL = 7;
export const DEFAULT_REMINDER_HOUR_LOCAL = 17;

export const LOCAL_HOURS = Array.from({ length: 24 }, (_, i) => i);

export function isLocalHour(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23
  );
}

/** The local wall-clock hour (0–23) of an instant in a timezone. */
export function localHourOf(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
  }).formatToParts(instant);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export interface DispatchBusiness {
  id: string;
  timezone: string;
  digestHourLocal: number;
  reminderHourLocal: number;
}

/** The hour a business wants `kind` at, from its own settings. */
export function sendHourFor(kind: SweepKind, biz: DispatchBusiness): number {
  const s = SWEEP_SCHEDULE[kind];
  if (s.hour === "digest") return biz.digestHourLocal;
  if (s.hour === "reminder") return biz.reminderHourLocal;
  return s.localHour;
}

export interface DueVerdict {
  due: boolean;
  /** The business-local calendar date the run belongs to. */
  runDate: DateOnly;
  localHour: number;
  targetHour: number;
}

/**
 * Is `kind` due for this business at `now`? Due once the local hour has
 * reached the target; the caller's per-(kind, business, runDate) record makes
 * a second hour in the same local day a no-op.
 */
export function sweepDue(
  kind: SweepKind,
  biz: DispatchBusiness,
  now: Date,
): DueVerdict {
  const localHour = localHourOf(now, biz.timezone);
  const targetHour = sendHourFor(kind, biz);
  return {
    due: localHour >= targetHour,
    runDate: businessDateOf(now, biz.timezone),
    localHour,
    targetHour,
  };
}

/** pg-boss singleton key: one queued/active job per tenant per day per kind. */
export function sweepSingletonKey(
  kind: SweepKind,
  businessId: string,
  runDate: DateOnly,
): string {
  return `${kind}:${businessId}:${runDate}`;
}

/** One dispatcher run's counters, for the log line. */
export interface DispatchSummary {
  scanned: number;
  enqueued: Record<SweepKind, number>;
  durationMs: number;
}

export function emptySummary(): DispatchSummary {
  return {
    scanned: 0,
    enqueued: Object.fromEntries(SWEEP_KINDS.map((k) => [k, 0])) as Record<
      SweepKind,
      number
    >,
    durationMs: 0,
  };
}
