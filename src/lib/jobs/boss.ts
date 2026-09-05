import { PgBoss, type Job, type Queue } from "pg-boss";
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
  type DataRetentionJob,
  type SweepDispatchJob,
  type BusinessSweepJob,
  type DeadLetterJob,
  LEGACY_SWEEP_QUEUES,
} from "./queues";
import { dispatchDailySweeps, runBusinessSweep } from "./sweeps";
import { handleDeadLetter } from "./dead-letter";
import { sweepSingletonKey } from "./dispatch";
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
  handleDataRetention,
} from "./handlers";

/**
 * Cron for the daily platform data-retention sweep (PERF-10): 04:00 UTC, an
 * hour after photo retention and clear of the reminder/digest sends.
 */
const DATA_RETENTION_CRON = "0 4 * * *";

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

/** What `createQueue` accepts: every queue setting, including `policy`. */
type CreateQueueOptions = Omit<Queue, "name">;
/** What `updateQueue` accepts: `policy` and `partition` are fixed at creation. */
type UpdateQueueOptions = Omit<CreateQueueOptions, "policy" | "partition">;

/**
 * Finished (completed/failed) jobs are kept this long for diagnosis before
 * pg-boss's maintenance deletes them. A per-QUEUE setting in pg-boss 12
 * (`deleteAfterSeconds`; the library default is 7 days), applied by the worker
 * at boot — `createQueue` is an insert-if-absent, so an `updateQueue` follows
 * it to bring queues that already existed up to the same retention.
 */
export const JOB_RETENTION_SECONDS = 14 * 24 * 60 * 60;

const QUEUE_DEFAULTS = { deleteAfterSeconds: JOB_RETENTION_SECONDS } as const;

/**
 * Per-queue settings. Every queue except the dead-letter queue itself
 * dead-letters into it (OPS-02): a job that exhausts its retries is copied
 * there instead of being abandoned, and `handleDeadLetter` makes it visible.
 *
 * Policy `short`: at most ONE job per singleton key may sit in `created` at
 * a time, so a duplicate enqueue — a double-submitted publish, a
 * re-triggered reminder, the dispatcher re-run by hand — is dropped rather
 * than queued twice. On pg-boss's default `standard` policy a `singletonKey`
 * is only metadata (nothing collapses), which is what the `singletonKey`
 * comments below always assumed it did. The dead-letter queue stays
 * `standard`: its jobs carry no key, and under `short` every keyless job
 * would share one slot and alerts would be dropped.
 */
export function queueOptions(name: string): CreateQueueOptions {
  return name === QUEUES.deadLetter
    ? { ...QUEUE_DEFAULTS }
    : { ...QUEUE_DEFAULTS, policy: "short", deadLetter: QUEUES.deadLetter };
}

/** The subset of `queueOptions` that `updateQueue` accepts (no `policy`). */
export function updatableQueueOptions(name: string): UpdateQueueOptions {
  const {
    policy: _fixedAtCreation,
    partition: _alsoFixed,
    ...rest
  } = queueOptions(name);
  void _fixedAtCreation;
  void _alsoFixed;
  return rest;
}

/**
 * A queue's policy is fixed at creation (`updateQueue` cannot change it), so
 * a queue that already exists with another policy is recreated — ONLY while
 * it is empty (no queued, deferred or active job), because deleting a queue
 * drops its jobs. A busy queue is left as it is, with a warning, and picked
 * up at the next boot that finds it idle.
 */
async function ensureQueuePolicy(boss: PgBoss, name: string): Promise<void> {
  const desired = queueOptions(name).policy ?? "standard";
  const existing = await boss.getQueue(name);
  if (!existing || (existing.policy ?? "standard") === desired) return;
  const stats = await boss.getQueueStats(name);
  if (stats.queuedCount > 0 || stats.activeCount > 0) {
    logger.warn(
      {
        queue: name,
        policy: existing.policy,
        desired,
        queued: stats.queuedCount,
        active: stats.activeCount,
      },
      "Queue policy differs but the queue is busy; keeping it until a boot finds it empty",
    );
    return;
  }
  await boss.deleteQueue(name);
  logger.info(
    { queue: name, from: existing.policy, to: desired },
    "Queue recreated with the intended policy",
  );
}

/** Cron for the hourly daily-sweep dispatcher (PERF-02 / PERF-03). */
const SWEEP_DISPATCH_CRON = "0 * * * *";

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
    // The dead-letter queue first: every other queue references it.
    await boss.createQueue(QUEUES.deadLetter, queueOptions(QUEUES.deadLetter));
    for (const name of Object.values(QUEUES)) {
      await ensureQueuePolicy(boss, name);
      await boss.createQueue(name, queueOptions(name));
      // `createQueue` is insert-if-absent; the update brings a queue that
      // already existed up to the current retention/dead-letter settings.
      // (`policy` is fixed at creation and rejected here — ensureQueuePolicy
      // above handles it.)
      await boss.updateQueue(name, updatableQueueOptions(name));
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
    // Every queue references the dead-letter queue, so on a database the
    // worker has never booted against it must exist before the first send.
    if (queue !== QUEUES.deadLetter && !known.has(QUEUES.deadLetter)) {
      await boss.createQueue(
        QUEUES.deadLetter,
        queueOptions(QUEUES.deadLetter),
      );
      known.add(QUEUES.deadLetter);
    }
    await boss.createQueue(queue, queueOptions(queue));
    known.add(queue);
  }
  return boss;
}

/**
 * One daily sweep for one business (the dispatcher's unit of work). The
 * singleton key holds exactly one queued/active job per tenant per sweep per
 * local day; the `job_dispatch` ledger holds exactly-once across ticks.
 */
export async function enqueueBusinessSweep(
  payload: BusinessSweepJob,
): Promise<void> {
  const boss = await producer(QUEUES.businessSweep);
  await boss.send(QUEUES.businessSweep, payload, {
    ...RETRY,
    singletonKey: sweepSingletonKey(
      payload.kind,
      payload.businessId,
      payload.runDate,
    ),
  });
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

  await boss.work<DataRetentionJob>(
    QUEUES.dataRetention,
    guarded(QUEUES.dataRetention, () => handleDataRetention()),
  );

  // PERF-02 / PERF-03: the hourly dispatcher fans the daily sweeps out to one
  // job per business; those run with bounded local concurrency so a slow
  // tenant never blocks the rest and email load stays paced.
  await boss.work<SweepDispatchJob>(
    QUEUES.sweepDispatch,
    guarded(QUEUES.sweepDispatch, () =>
      dispatchDailySweeps(new Date(), enqueueBusinessSweep),
    ),
  );
  await boss.work<BusinessSweepJob>(
    QUEUES.businessSweep,
    { localConcurrency: 4 },
    guarded(QUEUES.businessSweep, (job) => runBusinessSweep(job.data)),
  );

  // OPS-02: jobs that exhausted their retries on ANY queue land here.
  await boss.work<DeadLetterJob>(
    QUEUES.deadLetter,
    { includeMetadata: true },
    guarded(QUEUES.deadLetter, (job) =>
      handleDeadLetter({
        id: job.id,
        name: job.name,
        data: job.data,
        output: (job as { output?: unknown }).output,
        retryCount: (job as { retryCount?: number }).retryCount,
        createdOn: (job as { createdOn?: Date }).createdOn,
      }),
    ),
  );

  // PERF-02 / PERF-03: the six global daily crons are replaced by ONE hourly
  // dispatcher that fans each sweep out per business at that business's own
  // local send hour. Re-scheduling is idempotent (pg-boss upserts); the
  // legacy schedules are removed so a worker upgraded in place never runs
  // both. The legacy queues stay registered above as a manual rollback path.
  await boss.schedule(
    QUEUES.sweepDispatch,
    SWEEP_DISPATCH_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.sweepDispatch },
  );
  for (const legacy of LEGACY_SWEEP_QUEUES) {
    await boss.unschedule(legacy);
  }

  // Daily platform data-retention sweep (04:00 UTC). Idempotent reschedule;
  // every policy deletes only rows past its own cutoff, in bounded batches.
  await boss.schedule(
    QUEUES.dataRetention,
    DATA_RETENTION_CRON,
    {},
    { ...RETRY, tz: "UTC", singletonKey: QUEUES.dataRetention },
  );

  logger.info("Workers registered");
}
