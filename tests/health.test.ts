import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/schema";
import {
  heartbeatIsFresh,
  latestWorkerHeartbeat,
  oldestQueuedJobAgeMs,
  queueIsDraining,
  readinessChecks,
  recordWorkerHeartbeat,
  QUEUE_BACKLOG_STALE_MS,
  WORKER_HEARTBEAT_STALE_MS,
} from "@/lib/health";

/**
 * OPS-01: a dead worker must be DETECTABLE. `/api/ready` reports the newest
 * worker heartbeat and goes 503 when it is stale; these tests pin the
 * freshness rule and the upsert.
 */
const ID = `test-worker-${process.pid}`;

describe("worker heartbeat + readiness (OPS-01)", () => {
  afterAll(async () => {
    await db.delete(workerHeartbeats).where(eq(workerHeartbeats.id, ID));
  });

  it("treats a recent heartbeat as fresh and an old one as stale", () => {
    const now = new Date("2026-08-01T10:00:00Z");
    expect(heartbeatIsFresh(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(
      heartbeatIsFresh(
        new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 1),
        now,
      ),
    ).toBe(false);
    expect(heartbeatIsFresh(null, now)).toBe(false);
  });

  it("upserts one row per worker instance and reports the newest", async () => {
    const t1 = new Date("2026-08-01T10:00:00Z");
    const t2 = new Date("2026-08-01T10:01:00Z");
    await recordWorkerHeartbeat(ID, db, t1);
    await recordWorkerHeartbeat(ID, db, t2); // same id → overwritten, no 2nd row
    const rows = await db
      .select()
      .from(workerHeartbeats)
      .where(eq(workerHeartbeats.id, ID));
    expect(rows.length).toBe(1);
    expect(rows[0]!.seenAt.toISOString()).toBe(t2.toISOString());
    expect((await latestWorkerHeartbeat(db))!.getTime()).toBeGreaterThanOrEqual(
      t2.getTime(),
    );
  });

  it("readiness reports the database up and the worker fresh only when it beat recently", async () => {
    const now = new Date();
    await recordWorkerHeartbeat(ID, db, now);
    expect(await readinessChecks(db, now)).toMatchObject({
      database: true,
      worker: true,
      queue: true,
    });
    // Far in the future, that same beat is stale.
    const later = new Date(now.getTime() + WORKER_HEARTBEAT_STALE_MS * 2);
    expect((await readinessChecks(db, later)).worker).toBe(false);
  });

  it("treats the queue as draining unless a due job has waited too long; unknown is not a failure", async () => {
    expect(queueIsDraining(null)).toBe(true);
    expect(queueIsDraining(0)).toBe(true);
    expect(queueIsDraining(QUEUE_BACKLOG_STALE_MS - 1)).toBe(true);
    expect(queueIsDraining(QUEUE_BACKLOG_STALE_MS)).toBe(false);
    // On a database with or without the pg-boss schema the probe never throws.
    const age = await oldestQueuedJobAgeMs(db, new Date());
    expect(age === null || age >= 0).toBe(true);
  });
});
