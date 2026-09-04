// Container HEALTHCHECK for the worker (OPS-01). Exits 0 when the worker
// wrote its heartbeat file within the staleness window, 1 otherwise. Reads a
// file, not the database, so the check itself can't be the thing that fails.
import { statSync } from "node:fs";
import process from "node:process";

const file =
  process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/roster-worker-heartbeat";
const STALE_MS = 5 * 60 * 1000;

try {
  const age = Date.now() - statSync(file).mtimeMs;
  process.exit(age < STALE_MS ? 0 : 1);
} catch {
  process.exit(1);
}
