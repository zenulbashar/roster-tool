import { sanitizeRecord } from "@/lib/audit/events";

/**
 * Operator tooling for the job queue (OPS-03 runbooks) — the PURE half.
 *
 * `scripts/jobs-admin.ts` is the CLI; this module owns everything that can
 * be unit-tested without a database: argument parsing, the sanitised summary
 * of a failed job (a job payload can carry a magic-link token — it must never
 * be printed), and the usage text. Nothing here talks to Postgres or pg-boss.
 */

export type JobsAdminCommand =
  | { cmd: "help" }
  | { cmd: "stats" }
  /** List jobs that exhausted their retries, newest first. */
  | { cmd: "failed"; limit: number }
  /** Re-run ONE failed job in place (pg-boss `retry`: state → retry). */
  | { cmd: "retry"; queue: string; id: string }
  /**
   * Re-run the hourly dispatcher for ONE business. With `force`, the
   * business's `job_dispatch` claims for the local date at `at` are cleared
   * first so every sweep already past its send hour is enqueued again.
   */
  | { cmd: "redispatch"; businessId: string; force: boolean; at: Date };

export const JOBS_ADMIN_USAGE = `Usage: npm run jobs:admin -- <command> [options]

Commands
  stats                         Queue depth per queue (queued / active / deferred).
  failed [--limit N]            Jobs that exhausted their retries (default 20, newest
                                first). Payloads are sanitised; tokens never print.
  retry --queue <q> --id <id>   Re-run one failed job in place (pg-boss retry).
  redispatch --business <id>    Run the daily-sweep dispatcher for ONE business now.
             [--force] [--at <ISO>]
                                --force clears that business's job_dispatch claims
                                for the local date first, so every sweep whose
                                send hour has passed is enqueued again.
  help                          This text.

Runs against DATABASE_URL (use the DIRECT Neon connection, not the pooler).
See docs/operations.md → Runbooks.`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function option(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  return value === undefined || value.startsWith("--") ? "" : value;
}

/**
 * Parse `process.argv.slice(2)`. Returns a command or a human-readable
 * error — never throws, so the CLI can print the error plus the usage.
 */
export function parseJobsAdminArgs(
  argv: string[],
  now: Date = new Date(),
): JobsAdminCommand | { error: string } {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { cmd: "help" };
    case "stats":
      return { cmd: "stats" };
    case "failed": {
      const raw = option(rest, "--limit");
      if (raw === undefined) return { cmd: "failed", limit: 20 };
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        return { error: "--limit must be a whole number between 1 and 500" };
      }
      return { cmd: "failed", limit };
    }
    case "retry": {
      const queue = option(rest, "--queue");
      const id = option(rest, "--id");
      if (!queue) return { error: "retry needs --queue <name>" };
      if (!id || !UUID_RE.test(id)) {
        return { error: "retry needs --id <job uuid> (from `failed`)" };
      }
      return { cmd: "retry", queue, id };
    }
    case "redispatch": {
      const businessId = option(rest, "--business");
      if (!businessId || !UUID_RE.test(businessId)) {
        return { error: "redispatch needs --business <business uuid>" };
      }
      const force = rest.includes("--force");
      const atRaw = option(rest, "--at");
      let at = now;
      if (atRaw !== undefined) {
        const parsed = new Date(atRaw);
        if (!atRaw || Number.isNaN(parsed.getTime())) {
          return { error: "--at must be an ISO-8601 instant" };
        }
        at = parsed;
      }
      return { cmd: "redispatch", businessId, force, at };
    }
    default:
      return { error: `Unknown command: ${cmd}` };
  }
}

/** One `pgboss.job` row in state `failed`, as the CLI reads it. */
export interface FailedJobRow {
  id: string;
  name: string;
  data: unknown;
  output: unknown;
  retryCount: number;
  createdOn: Date;
  completedOn: Date | null;
}

export interface FailedJobSummary {
  id: string;
  queue: string;
  /** Sanitised: secrets redacted by key, opaque strings masked. */
  data: unknown;
  lastError: string | null;
  retryCount: number;
  failedAt: string | null;
  ageMinutes: number;
}

/** The message pg-boss stored as the job's last failure, if any. */
export function lastErrorMessage(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  // pg-boss wraps handler errors as `{ value: { message } }` for timeouts and
  // stores thrown errors' serialisable fields (`message`, `stack`) directly.
  const inner = (o.value as Record<string, unknown> | undefined) ?? o;
  const message = inner?.message ?? o.message;
  return typeof message === "string" ? message : null;
}

/**
 * A printable summary of a failed job. The payload goes through the audit
 * sanitiser (`sanitizeRecord`), so a token or PIN in a job's data prints as
 * `[redacted]` and long opaque strings are masked — the same rule the
 * dead-letter alert follows.
 */
export function summarizeFailedJob(
  row: FailedJobRow,
  now: Date = new Date(),
): FailedJobSummary {
  const failedAt = row.completedOn ?? null;
  return {
    id: row.id,
    queue: row.name,
    data: sanitizeRecord(row.data),
    lastError: lastErrorMessage(row.output),
    retryCount: row.retryCount,
    failedAt: failedAt ? failedAt.toISOString() : null,
    ageMinutes: Math.max(
      0,
      Math.round(
        (now.getTime() - (failedAt ?? row.createdOn).getTime()) / 60_000,
      ),
    ),
  };
}
