import { PgBoss, type Job } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  QUEUES,
  type AvailabilityRequestJob,
  type AvailabilityReminderJob,
  type PublishedRosterJob,
  type PhotoRetentionJob,
  type LeaveDecisionJob,
} from "./queues";
import {
  handleAvailabilityRequest,
  handleAvailabilityReminder,
  handlePublishedRoster,
  handlePhotoRetention,
  handleLeaveDecision,
} from "./handlers";

/** Cron for the daily clock-in photo retention sweep: 03:00 UTC every day. */
const PHOTO_RETENTION_CRON = "0 3 * * *";

/**
 * pg-boss singleton. One instance per process (Next dev hot-reload safe via
 * globalThis). Jobs are retried with exponential backoff; queues are created on
 * start so enqueuing/working is safe immediately.
 */
const globalForBoss = globalThis as unknown as { __boss?: PgBoss };

const RETRY = { retryLimit: 5, retryBackoff: true } as const;

export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.__boss) return globalForBoss.__boss;

  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (err: Error) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }
  globalForBoss.__boss = boss;
  return boss;
}

export async function enqueueAvailabilityRequest(
  payload: AvailabilityRequestJob,
): Promise<void> {
  const boss = await getBoss();
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
  const boss = await getBoss();
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
  const boss = await getBoss();
  await boss.send(QUEUES.publishedRoster, payload, {
    ...RETRY,
    singletonKey: `${payload.rosterPeriodId}:${payload.staffMemberId}`,
  });
}

export async function enqueueLeaveDecision(
  payload: LeaveDecisionJob,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUES.leaveDecision, payload, {
    ...RETRY,
    // Collapse duplicate enqueues for the same decision.
    singletonKey: payload.leaveRequestId,
  });
}

/**
 * Register all job handlers. Called by the worker process. The handler receives
 * a batch of jobs from pg-boss; we process each.
 */
export async function registerWorkers(): Promise<void> {
  const boss = await getBoss();

  await boss.work<AvailabilityRequestJob>(
    QUEUES.availabilityRequest,
    async (jobs: Job<AvailabilityRequestJob>[]) => {
      for (const job of jobs) {
        await handleAvailabilityRequest(job.data);
      }
    },
  );

  await boss.work<AvailabilityReminderJob>(
    QUEUES.availabilityReminder,
    async (jobs: Job<AvailabilityReminderJob>[]) => {
      for (const job of jobs) {
        await handleAvailabilityReminder(job.data);
      }
    },
  );

  await boss.work<PublishedRosterJob>(
    QUEUES.publishedRoster,
    async (jobs: Job<PublishedRosterJob>[]) => {
      for (const job of jobs) {
        await handlePublishedRoster(job.data);
      }
    },
  );

  await boss.work<PhotoRetentionJob>(
    QUEUES.photoRetention,
    async (jobs: Job<PhotoRetentionJob>[]) => {
      for (const _job of jobs) {
        await handlePhotoRetention();
      }
    },
  );

  await boss.work<LeaveDecisionJob>(
    QUEUES.leaveDecision,
    async (jobs: Job<LeaveDecisionJob>[]) => {
      for (const job of jobs) {
        await handleLeaveDecision(job.data);
      }
    },
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

  logger.info("Workers registered");
}
