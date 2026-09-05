/**
 * Background worker. Runs pg-boss handlers that send availability requests,
 * reminders, and published rosters. Run alongside the app: `npm run worker`.
 *
 * Liveness (OPS-01): every minute the worker writes a heartbeat in two places —
 *  - the `worker_heartbeat` table, which `/api/ready` reads (an uptime monitor
 *    on that URL is the alert for a dead or wedged worker), and
 *  - a local file, whose mtime the container HEALTHCHECK checks without needing
 *    database access.
 * A worker that stops beating for 5 minutes is reported down by both.
 */
import { writeFile } from "node:fs/promises";
import { getBoss, registerWorkers } from "../src/lib/jobs/boss";
import { logger } from "../src/lib/logger";
import { reportError } from "../src/lib/error-reporting";
import {
  recordWorkerHeartbeat,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "../src/lib/health";

export const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/roster-worker-heartbeat";

const instanceId =
  process.env.RAILWAY_REPLICA_ID ??
  process.env.HOSTNAME ??
  `worker-${process.pid}`;

let beat: NodeJS.Timeout | null = null;

async function heartbeat() {
  const now = new Date();
  try {
    await recordWorkerHeartbeat(instanceId, undefined, now);
  } catch (err) {
    // The DB heartbeat failing is itself a signal /api/ready will surface
    // (stale); log it so the cause is visible.
    logger.error({ err }, "Worker heartbeat write failed");
  }
  try {
    await writeFile(HEARTBEAT_FILE, now.toISOString());
  } catch (err) {
    logger.warn({ err }, "Worker heartbeat file write failed");
  }
}

async function main() {
  await registerWorkers();
  await heartbeat();
  beat = setInterval(() => void heartbeat(), WORKER_HEARTBEAT_INTERVAL_MS);
  beat.unref();
  logger.info({ instanceId }, "Worker started. Waiting for jobs…");
}

async function shutdown() {
  logger.info("Worker shutting down…");
  if (beat) clearInterval(beat);
  try {
    const boss = await getBoss();
    await boss.stop({ graceful: true });
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (err) => {
  // A rejection nobody awaited would otherwise kill the process silently
  // (Node's default) — report it, then let the platform restart us.
  void reportError({
    error: err,
    tags: { source: "worker", event: "unhandledRejection" },
  }).finally(() => process.exit(1));
});

main().catch((err) => {
  void reportError({
    error: err,
    tags: { source: "worker", event: "startup" },
  }).finally(() => process.exit(1));
});
