/**
 * Background worker. Runs pg-boss handlers that send availability requests,
 * reminders, and published rosters. Run alongside the app: `npm run worker`.
 */
import { getBoss, registerWorkers } from "../src/lib/jobs/boss";
import { logger } from "../src/lib/logger";

async function main() {
  await registerWorkers();
  logger.info("Worker started. Waiting for jobs…");
}

async function shutdown() {
  logger.info("Worker shutting down…");
  try {
    const boss = await getBoss();
    await boss.stop({ graceful: true });
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  logger.error({ err }, "Worker failed to start");
  process.exit(1);
});
