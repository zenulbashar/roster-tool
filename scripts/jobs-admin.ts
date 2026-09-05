/**
 * Operator CLI for the background-job queue (OPS-03 runbooks):
 *
 *   npm run jobs:admin -- stats
 *   npm run jobs:admin -- failed [--limit 20]
 *   npm run jobs:admin -- retry --queue published-roster --id <job id>
 *   npm run jobs:admin -- redispatch --business <id> [--force] [--at <ISO>]
 *
 * A job that exhausts its retries stays in its OWN queue in state `failed`
 * (pg-boss copies it to `dead-letter` only so the alert fires). `failed`
 * lists those with a sanitised payload; `retry` puts one back to `retry` in
 * place (same id, same singleton key, retry budget +1), so re-running a lost
 * roster email is one command. `redispatch` re-runs the hourly sweep
 * dispatcher for a single business — the way to re-send a tenant's daily
 * digests after a fix without touching anyone else. Argument parsing and the
 * summaries are pure (src/lib/jobs/admin.ts) and unit-tested.
 *
 * Reads DATABASE_URL from the environment — use the DIRECT Neon connection.
 */
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { businesses, jobDispatches } from "../src/lib/db/schema";
import { enqueueBusinessSweep, getBoss } from "../src/lib/jobs/boss";
import { QUEUES } from "../src/lib/jobs/queues";
import { dispatchDailySweeps } from "../src/lib/jobs/sweeps";
import {
  JOBS_ADMIN_USAGE,
  parseJobsAdminArgs,
  summarizeFailedJob,
  type FailedJobRow,
} from "../src/lib/jobs/admin";
import { businessDateOf } from "../src/lib/time";

const out = (line: string) => process.stdout.write(`${line}\n`);

async function stats() {
  const boss = await getBoss();
  out("queue\tqueued\tactive\tdeferred\ttotal");
  for (const name of Object.values(QUEUES)) {
    // A queue exists once the worker has booted against this database.
    if (!(await boss.getQueue(name))) {
      out(`${name}\t(not created yet — the worker has not run here)`);
      continue;
    }
    const q = await boss.getQueueStats(name);
    out(
      `${name}\t${q.queuedCount}\t${q.activeCount}\t${q.deferredCount}\t${q.totalCount}`,
    );
  }
}

async function failed(limit: number) {
  const res = await db.execute(
    sql`select id, name, data, output, retry_count as "retryCount", created_on as "createdOn", completed_on as "completedOn"
          from pgboss.job
         where state = 'failed' and name <> ${QUEUES.deadLetter}
         order by completed_on desc nulls last, created_on desc
         limit ${limit}`,
  );
  const rows = res.rows as unknown as FailedJobRow[];
  if (rows.length === 0) {
    out("No failed jobs.");
    return;
  }
  const now = new Date();
  for (const row of rows) {
    const s = summarizeFailedJob(
      {
        ...row,
        createdOn: new Date(row.createdOn),
        completedOn: row.completedOn ? new Date(row.completedOn) : null,
      },
      now,
    );
    out(
      `${s.queue}\t${s.id}\tfailed ${s.ageMinutes} min ago after ${s.retryCount} retries`,
    );
    out(`  error: ${s.lastError ?? "(none recorded)"}`);
    out(`  data:  ${JSON.stringify(s.data)}`);
  }
  out(
    `\nRe-run one with: npm run jobs:admin -- retry --queue <queue> --id <id>`,
  );
}

async function retry(queue: string, id: string) {
  if (!(Object.values(QUEUES) as string[]).includes(queue)) {
    throw new Error(`Unknown queue "${queue}"`);
  }
  const boss = await getBoss();
  const res = await boss.retry(queue, id);
  const affected = (res as { affected?: number }).affected ?? 0;
  if (affected === 0) {
    throw new Error(
      `No failed job ${id} in queue ${queue} (already retried, or not failed)`,
    );
  }
  out(`Queued job ${id} on ${queue} to run again.`);
}

async function redispatch(businessId: string, force: boolean, at: Date) {
  const [biz] = await db
    .select({ id: businesses.id, timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!biz) throw new Error(`No business ${businessId}`);
  const runDate = businessDateOf(at, biz.timezone);
  if (force) {
    const cleared = await db
      .delete(jobDispatches)
      .where(
        and(
          eq(jobDispatches.businessId, biz.id),
          eq(jobDispatches.runDate, runDate),
        ),
      )
      .returning({ kind: jobDispatches.kind });
    out(
      `Cleared ${cleared.length} dispatch claim(s) for ${runDate}: ${cleared
        .map((c) => c.kind)
        .join(", ")}`,
    );
  }
  const summary = await dispatchDailySweeps(at, enqueueBusinessSweep, db, {
    businessIds: [biz.id],
  });
  const enqueued = Object.entries(summary.enqueued)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind}×${n}`);
  out(
    enqueued.length
      ? `Enqueued for ${runDate} (${biz.timezone}): ${enqueued.join(", ")}`
      : `Nothing due for ${runDate} (${biz.timezone}) — every sweep past its send hour was already dispatched today (use --force to re-run them).`,
  );
}

async function main() {
  const parsed = parseJobsAdminArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n\n${JOBS_ADMIN_USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  switch (parsed.cmd) {
    case "help":
      out(JOBS_ADMIN_USAGE);
      return;
    case "stats":
      await stats();
      return;
    case "failed":
      await failed(parsed.limit);
      return;
    case "retry":
      await retry(parsed.queue, parsed.id);
      return;
    case "redispatch":
      await redispatch(parsed.businessId, parsed.force, parsed.at);
      return;
  }
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const boss = await getBoss();
      await boss.stop({ graceful: false, close: true });
    } catch {
      // Nothing to stop.
    }
    await db.$client.end();
  });
