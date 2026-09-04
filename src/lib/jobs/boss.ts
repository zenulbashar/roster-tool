import { PgBoss, type Job } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/error-reporting";
import {
  QUEUES,
  type AvailabilityRequestJob,
  type AvailabilityReminderJob,
  type PublishedRosterJob,
  type PhotoRetentionJob,
  type LeaveDecisionJob,
  type ShiftOfferDecisionJob,
  type CertReminderJob,
  type OrderReminderJob,
  type StaffShiftReminderJob,
  type StaffLoanExpiryJob,
  type FormResponseDigestJob,
} from "./queues";
import {
  handleAvailabilityRequest,
  handleAvailabilityReminder,
  handlePublishedRoster,
  handlePhotoRetention,
  handleLeaveDecision,
  handleShiftOfferDecision,
  handleCertificationReminders,
  handleOrderReminders,
  handleStaffShiftReminders,
  handleStaffLoanExpiry,
  handleFormResponseDigests,
} from "./handlers";

/** Cron for the daily clock-in photo retention sweep: 03:00 UTC every day. */
const PHOTO_RETENTION_CRON = "0 3 * * *";

/** Cron for the daily certification expiry reminder sweep: 02:00 UTC. */
const CERT_REMINDER_CRON = "0 2 * * *";

/** Cron for the daily stock order-reminder sweep: 06:00 UTC. */
const ORDER_REMINDER_CRON = "0 6 * * *";

/**
 * Cron for the daily IN-APP staff shift reminder ("you work tomorrow"):
 * 07:00 UTC ≈ 5–6 pm in Australia/Sydney — the evening before the shift.
 */
const STAFF_SHIFT_REMINDER_CRON = "0 7 * * *";

/** Cron for the daily staff-loan expiry sweep: 01:00 UTC every day. */
const STAFF_LOAN_EXPIRY_CRON = "0 1 * * *";

/**
 * Cron for the daily form-response email digest: 21:00 UTC ≈ 7–8 am in
 * Australia/Sydney — the owner reads yesterday's responses with their coffee.
 */
const FORM_DIGEST_CRON = "0 21 * * *";

/**
 * pg-boss singleton. One instance per process (Next dev hot-reload safe via
 * globalThis). Jobs are retried with exponential backoff.
 *
 * Two shapes, chosen by ROSTER_ROLE (PERF-07):
 *  - the WORKER owns the queue: it migrates the pg-boss schema, creates every
 *    queue at boot, runs supervision/maintenance and the cron scheduler, and
 *    archives finished jobs (kept two weeks for diagnosis, then deleted);
 *  - the WEB app is a SEND-ONLY producer: no supervision, no scheduler, and no
 *    eleven-queue upsert on every serverless cold start — a queue is ensured
 *    lazily the first time this process sends to it (a one-off safety net for
 *    a fresh deploy where web wakes before the worker has created queues).
 */
const globalForBoss = globalThis as unknown as {
  __boss?: PgBoss;
  __bossQueues?: Set<string>;
};

const RETRY = { retryLimit: 5, retryBackoff: true } as const;

const isWorker = env.ROSTER_ROLE === "worker";

/**
 * Finished (completed/failed) jobs are kept this long for diagnosis before
 * pg-boss's maintenance deletes them. A per-QUEUE setting in pg-boss 12
 * (`deleteAfterSeconds`; the library default is 7 days), applied by the worker
 * at boot — `createQueue` is an insert-if-absent, so an `updateQueue` follows
 * it to bring queues that already existed up to the same retention.
 */
export const JOB_RETENTION_SECONDS = 14 * 24 * 60 * 60;

const QUEUE_DEFAULTS = { deleteAfterSeconds: JOB_RETENTION_SECONDS } as const;

export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.__boss) return globalForBoss.__boss;

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Only the worker supervises, schedules and maintains. Web still runs the
    // (cheap, no-op when current) schema version check so a fresh database
    // never leaves a producer facing a missing schema.
    supervise: isWorker,
    schedule: isWorker,
    migrate: true,
  });
  boss.on("error", (err: Error) => {
    void reportError({ error: err, tags: { source: "pg-boss" } });
  });
  await boss.start();
  if (isWorker) {
    for (const name of Object.values(QUEUES)) {
      await boss.createQueue(name, QUEUE_DEFAULTS);
      await boss.updateQueue(name, QUEUE_DEFAULTS);
    }
    globalForBoss.__bossQueues = new Set(Object.values(QUEUES));
  }
  globalForBoss.__boss = boss;
  return boss;
}

/**
 * The producer-side handle: the boss instance with the named queue guaranteed
 * to exist. In the worker every queue was created at boot; in web the first
 * send to a queue in this process performs the (idempotent) upsert once.
 */
async function producer(queue: string): Promise<PgBoss> {
  const boss = await getBoss();
  const known = (globalForBoss.__bossQueues ??= new Set<string>());
  if (!known.has(queue)) {
    await boss.createQueue(queue, QUEUE_DEFAULTS);
    known.add(queue);
  }
  return boss;
}

export async function enqueueAvailabilityRequest(
  payload: AvailabilityRequestJob,
): Promise<void> {
  const boss = await producer(QUEUES.availabilityRequest);
  await boss.send(QUEUES.availabilityRequest, payload, {
    ...RETRY,
    // Collapse duplicate enqueues for the same request.
    singletonKey: payload.requestId,
  });
}

/**
 * Schedule a reminder for a single request to run at `runAt` (just before the
 * deadline). singletonKey makes re-triggering safe.
 */
export async function scheduleAvailabilityReminder(
  payload: AvailabilityReminderJob,
  runAt: Date,
): Promise<void> {
  const boss = await producer(QUEUES.availabilityReminder);
  await boss.sendAfter(
    QUEUES.availabilityReminder,
    payload,
    { ...RETRY, singletonKey: payload.requestId },
    runAt,
  );
}

export async function enqueuePublishedRoster(
  payload: PublishedRosterJob,
): Promise<void> {
  const boss = await producer(QUEUES.publishedRoster);
  await boss.send(QUEUES.publishedRoster, payload, {
    ...RETRY,
    singletonKey: `${payload.rosterPeriodId}:${payload.staffMemberId}`,
  });
}

export async function enqueueLeaveDecision(
  payload: LeaveDecisionJob,
): Promise<void> {
  const boss = await producer(QUEUES.leaveDecision);
  await boss.send(QUEUES.leaveDecision, payload, {
    ...RETRY,
    // Collapse duplicate enqueues for the same decision.
    singletonKey: payload.leaveRequestId,
  });
}

export async function enqueueShiftOfferDecision(
  payload: ShiftOfferDecisionJob,
): Promise<void> {
  const boss = await producer(QUEUES.shiftOfferDecision);
  await boss.send(QUEUES.shiftOfferDecision, payload, {
    ...RETRY,
    // Collapse duplicate enqueues for the same offer.
    singletonKey: payload.shiftOfferId,
  });
}

/**
 * Run one job under structured logging + error reporting (OPS-01): every
 * handler invocation logs its queue + job id + duration, and a failure is
 * reported (log line + forwarded to the error tracker when configured) and
 * then RE-THROWN so pg-boss still retries it — nothing is swallowed. The
 * worker is the one place errors previously vanished into pg-boss's retry
 * loop with no signal; this makes each failure a visible, correlated event.
 */
function guarded<T extends object>(
  queue: string,
  handler: (job: Job<T>) => Promise<unknown>,
): (jobs: Job<T>[]) => Promise<void> {
  return async (jobs) => {
    for (const job of jobs) {
      const started = Date.now();
      const log = logger.child({ queue, jobId: job.id });
      try {
        await handler(job);
        log.info({ durationMs: Date.now() - started }, "Job completed");
      } catch (err) {
        await reportError({
          error: err,
          tags: { source: "worker", queue, jobId: job.id },
        });
        throw err;
      }
    }
  };
}

/**
 * Register all job handlers. Called by the worker process. The handler receives
 * a batch of jobs from pg-boss; we process each.
 */
export async function registerWorkers(): Promise<void> {
  const boss = await getBoss();

  await boss.work<AvailabilityRequestJob>(
    QUEUES.availabilityRequest,
    guarded(QUEUES.availabilityRequest, (job) =>
      handleAvailabilityRequest(job.data),
    ),
  );

  await boss.work<AvailabilityReminderJob>(
    QUEUES.availabilityReminder,
    guarded(QUEUES.availabilityReminder, (job) =>
      handleAvailabilityReminder(job.data),
    ),
  );

  await boss.work<PublishedRosterJob>(
    QUEUES.publishedRoster,
    guarded(QUEUES.publishedRoster, (job) => handlePublishedRoster(job.data)),
  );

  await boss.work<PhotoRetentionJob>(
    QUEUES.photoRetention,
    guarded(QUEUES.photoRetention, () => handlePhotoRetention()),
  );

  await boss.work<LeaveDecisionJob>(
    QUEUES.leaveDecision,
    guarded(QUEUES.leaveDecision, (job) => handleLeaveDecision(job.data)),
  );

  await boss.work<ShiftOfferDecisionJob>(
    QUEUES.shiftOfferDecision,
    guarded(QUEUES.shiftOfferDecision, (job) =>
      handleShiftOfferDecision(job.data),
    ),
  );

  await boss.work<CertReminderJob>(
    QUEUES.certReminder,
    guarded(QUEUES.certReminder, () => handleCertificationReminders()),
  );

  await boss.work<OrderReminderJob>(
    QUEUES.orderReminder,
    guarded(QUEUES.orderReminder, () => handleOrderReminders()),
  );

  await boss.work<StaffShiftReminderJob>(
    QUEUES.staffShiftReminder,
    guarded(QUEUES.staffShiftReminder, () => handleStaffShiftReminders()),
  );

  await boss.work<StaffLoanExpiryJob>(
    QUEUES.staffLoanExpiry,
    guarded(QUEUES.staffLoanExpiry, () => handleStaffLoanExpiry()),
  );

  await boss.work<FormResponseDigestJob>(
    QUEUES.formResponseDigest,
    guarded(QUEUES.formResponseDigest, () => handleFormResponseDigests()),
  );

  // Daily cron sweep of expired clock-in photos. Re-scheduling with the same
  // queue name is idempotent (pg-boss upserts the schedule), so booting the
  // worker repeatedly is safe. singletonKey collapses any overlapping runs.
  await boss.schedule(
    QUEUES.photoRetention,
    PHOTO_RETENTION_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.photoRetention },
  );

  // Daily certification expiry reminders (02:00 UTC). Idempotent reschedule.
  await boss.schedule(
    QUEUES.certReminder,
    CERT_REMINDER_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.certReminder },
  );

  // Daily stock order reminders (06:00 UTC). Idempotent reschedule.
  await boss.schedule(
    QUEUES.orderReminder,
    ORDER_REMINDER_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.orderReminder },
  );

  // Daily in-app staff shift reminders (07:00 UTC). Idempotent reschedule;
  // the handler itself dedupes per staff member per date.
  await boss.schedule(
    QUEUES.staffShiftReminder,
    STAFF_SHIFT_REMINDER_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.staffShiftReminder },
  );

  // Daily staff-loan expiry (01:00 UTC). Idempotent reschedule; the handler
  // only acts on still-active loans past their end date.
  await boss.schedule(
    QUEUES.staffLoanExpiry,
    STAFF_LOAN_EXPIRY_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.staffLoanExpiry },
  );

  // Daily form-response email digest (21:00 UTC). Idempotent reschedule; the
  // handler advances a per-business cursor only after a successful send.
  await boss.schedule(
    QUEUES.formResponseDigest,
    FORM_DIGEST_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.formResponseDigest },
  );

  logger.info("Workers registered");
}
