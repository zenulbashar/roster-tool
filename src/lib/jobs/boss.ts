import { PgBoss, type Job } from "pg-boss";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { QUEUES, type AvailabilityRequestJob } from "./queues";
import { handleAvailabilityRequest } from "./handlers";

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

  logger.info("Workers registered");
}
