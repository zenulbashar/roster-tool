import { desc, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";

/**
 * Health + readiness signals (OPS-01).
 *
 * `/api/health` is liveness: the process answers. `/api/ready` is readiness:
 * the database answers AND a background worker has checked in recently AND
 * the job queue is not backed up. The worker heartbeat is the one signal that
 * catches the product's most likely serious incident — a worker that died or
 * wedged, silently stopping every email — so its staleness threshold is
 * deliberately short. The queue-backlog check catches the subtler case of a
 * worker that is alive (still beating) but not draining work.
 */

/** A heartbeat older than this means the worker is down or wedged. */
export const WORKER_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** How often a running worker writes its heartbeat. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * A job that has been waiting (due, not yet picked up) longer than this
 * means the queue is not draining — the "oldest pending age" metric that
 * catches a wedged worker (OPS-01 item 5).
 */
export const QUEUE_BACKLOG_STALE_MS = 60 * 60 * 1000;

export type ReadinessChecks = {
  database: boolean;
  worker: boolean;
  queue: boolean;
  /** Age of the oldest due-but-unstarted job, or null when unknown. */
  queueBacklogMs: number | null;
};

/** Pure: is a heartbeat seen at `seenAt` still fresh at `now`? */
export function heartbeatIsFresh(
  seenAt: Date | null | undefined,
  now: Date = new Date(),
  staleMs: number = WORKER_HEARTBEAT_STALE_MS,
): boolean {
  if (!seenAt) return false;
  return now.getTime() - seenAt.getTime() < staleMs;
}

/** Pure: is a backlog of `ageMs` acceptable? Unknown (null) is not a failure. */
export function queueIsDraining(
  ageMs: number | null,
  staleMs: number = QUEUE_BACKLOG_STALE_MS,
): boolean {
  return ageMs === null || ageMs < staleMs;
}

/** Upsert this worker instance's heartbeat (one row per instance id). */
export async function recordWorkerHeartbeat(
  instanceId: string,
  database: Db = defaultDb,
  now: Date = new Date(),
): Promise<void> {
  await database
    .insert(workerHeartbeats)
    .values({ id: instanceId, seenAt: now })
    .onConflictDoUpdate({
      target: workerHeartbeats.id,
      set: { seenAt: now },
    });
}

/** The most recent heartbeat from ANY worker instance, or null. */
export async function latestWorkerHeartbeat(
  database: Db = defaultDb,
): Promise<Date | null> {
  const [row] = await database
    .select({ seenAt: workerHeartbeats.seenAt })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.seenAt))
    .limit(1);
  return row?.seenAt ?? null;
}

/**
 * How long the oldest DUE job has been waiting to be picked up, across every
 * queue (pg-boss's own table). 0 when nothing is waiting; null when the
 * pg-boss schema doesn't exist yet (a fresh database before the worker's
 * first boot) — unknown, not failing.
 */
export async function oldestQueuedJobAgeMs(
  database: Db = defaultDb,
  now: Date = new Date(),
): Promise<number | null> {
  try {
    const res = await database.execute(
      sql`select min(created_on) as oldest from pgboss.job where state in ('created', 'retry') and start_after <= now()`,
    );
    const oldest = (
      res.rows[0] as { oldest?: string | Date | null } | undefined
    )?.oldest;
    if (!oldest) return 0;
    return Math.max(0, now.getTime() - new Date(oldest).getTime());
  } catch {
    return null;
  }
}

/**
 * Run the readiness checks. Never throws: a failing dependency is reported
 * as `false` so the endpoint can answer 503 with detail rather than crash.
 */
export async function readinessChecks(
  database: Db = defaultDb,
  now: Date = new Date(),
): Promise<ReadinessChecks> {
  let database_ = false;
  let worker = false;
  let queueBacklogMs: number | null = null;
  try {
    await database.execute(sql`select 1`);
    database_ = true;
    worker = heartbeatIsFresh(await latestWorkerHeartbeat(database), now);
    queueBacklogMs = await oldestQueuedJobAgeMs(database, now);
  } catch {
    // Reported through the false flags.
  }
  return {
    database: database_,
    worker,
    queue: queueIsDraining(queueBacklogMs),
    queueBacklogMs,
  };
}
