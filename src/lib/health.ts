import { desc, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";

/**
 * Health + readiness signals (OPS-01).
 *
 * `/api/health` is liveness: the process answers. `/api/ready` is readiness:
 * the database answers AND a background worker has checked in recently. The
 * worker heartbeat is the one signal that catches the product's most likely
 * serious incident — a worker that died or wedged, silently stopping every
 * email — so its staleness threshold is deliberately short.
 */

/** A heartbeat older than this means the worker is down or wedged. */
export const WORKER_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/** How often a running worker writes its heartbeat. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 60 * 1000;

export type ReadinessChecks = { database: boolean; worker: boolean };

/** Pure: is a heartbeat seen at `seenAt` still fresh at `now`? */
export function heartbeatIsFresh(
  seenAt: Date | null | undefined,
  now: Date = new Date(),
  staleMs: number = WORKER_HEARTBEAT_STALE_MS,
): boolean {
  if (!seenAt) return false;
  return now.getTime() - seenAt.getTime() < staleMs;
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
 * Run the readiness checks. Never throws: a failing dependency is reported
 * as `false` so the endpoint can answer 503 with detail rather than crash.
 */
export async function readinessChecks(
  database: Db = defaultDb,
  now: Date = new Date(),
): Promise<ReadinessChecks> {
  let database_ = false;
  let worker = false;
  try {
    await database.execute(sql`select 1`);
    database_ = true;
    worker = heartbeatIsFresh(await latestWorkerHeartbeat(database), now);
  } catch {
    // Reported through the false flags.
  }
  return { database: database_, worker };
}
