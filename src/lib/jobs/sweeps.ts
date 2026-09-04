import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { businesses, jobDispatches } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { isForeignKeyViolation } from "@/lib/db/errors";
import {
  SWEEP_KINDS,
  emptySummary,
  sweepDue,
  type DispatchSummary,
  type SweepKind,
} from "./dispatch";
import type { BusinessSweepJob } from "./queues";
import {
  remindCertificationsForBusiness,
  remindOrdersForBusiness,
  sendFormDigestForBusiness,
  remindShiftsForBusiness,
  expireLoansForBusiness,
  purgePhotosForBusiness,
  type HandlerDeps,
} from "./handlers";

/**
 * The two halves of the daily-sweep fan-out (PERF-02 / PERF-03):
 *
 *  - `dispatchDailySweeps` — the HOURLY dispatcher. Pages every business
 *    (keyset on created_at, id — never the whole table in memory), asks the
 *    pure `sweepDue` which sweeps that location wants NOW in its own local
 *    time, claims a `job_dispatch` row per (kind, business, local date) with
 *    ON CONFLICT DO NOTHING, and enqueues one `BusinessSweepJob` for each
 *    claim. Exactly once per tenant per local day; a failed enqueue releases
 *    the claim so the next tick retries it.
 *
 *  - `runBusinessSweep` — the per-tenant job. Loads that ONE business and
 *    runs the matching per-business handler, which is idempotent through its
 *    own cursor. A failure retries THIS tenant only and, after the retry
 *    budget, lands in the dead-letter queue with the tenant named.
 */

export type EnqueueSweep = (job: BusinessSweepJob) => Promise<void>;

const PAGE_SIZE = 500;

type PageRow = {
  id: string;
  timezone: string;
  digestHourLocal: number;
  reminderHourLocal: number;
  createdAt: Date;
};

export async function dispatchDailySweeps(
  now: Date,
  enqueue: EnqueueSweep,
  database: Db = defaultDb,
  /**
   * Restrict the scan to these businesses — an operator re-dispatching one
   * tenant by hand, or a test on a shared database. Production ticks scan
   * everything.
   */
  scope?: { businessIds: string[] },
): Promise<DispatchSummary> {
  const started = Date.now();
  const summary = emptySummary();
  let cursor: { createdAt: Date; id: string } | null = null;
  if (scope && scope.businessIds.length === 0) return summary;

  for (;;) {
    const after = cursor
      ? or(
          gt(businesses.createdAt, cursor.createdAt),
          and(
            eq(businesses.createdAt, cursor.createdAt),
            gt(businesses.id, cursor.id),
          ),
        )
      : undefined;
    const only = scope ? inArray(businesses.id, scope.businessIds) : undefined;
    const page: PageRow[] = await database
      .select({
        id: businesses.id,
        timezone: businesses.timezone,
        digestHourLocal: businesses.digestHourLocal,
        reminderHourLocal: businesses.reminderHourLocal,
        createdAt: businesses.createdAt,
      })
      .from(businesses)
      .where(after && only ? and(after, only) : (after ?? only))
      .orderBy(asc(businesses.createdAt), asc(businesses.id))
      .limit(PAGE_SIZE);
    if (page.length === 0) break;

    for (const biz of page) {
      summary.scanned++;
      for (const kind of SWEEP_KINDS) {
        const verdict = sweepDue(kind, biz, now);
        if (!verdict.due) continue;
        let claimed: Array<{ kind: string }>;
        try {
          claimed = await database
            .insert(jobDispatches)
            .values({ kind, businessId: biz.id, runDate: verdict.runDate })
            .onConflictDoNothing()
            .returning({ kind: jobDispatches.kind });
        } catch (err) {
          // The business was deleted between the page read and the claim —
          // nothing to sweep; the next page is unaffected.
          if (isForeignKeyViolation(err)) break;
          throw err;
        }
        if (claimed.length === 0) continue; // already dispatched this local day
        try {
          await enqueue({ kind, businessId: biz.id, runDate: verdict.runDate });
          summary.enqueued[kind]++;
        } catch (err) {
          // Release the claim so the next hourly tick retries this tenant.
          await database
            .delete(jobDispatches)
            .where(
              and(
                eq(jobDispatches.kind, kind),
                eq(jobDispatches.businessId, biz.id),
                eq(jobDispatches.runDate, verdict.runDate),
              ),
            );
          throw err;
        }
      }
    }

    const last = page[page.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }

  summary.durationMs = Date.now() - started;
  logger.info(
    {
      scanned: summary.scanned,
      enqueued: summary.enqueued,
      durationMs: summary.durationMs,
    },
    "Sweep dispatch complete",
  );
  return summary;
}

/** Run one sweep for one business. Returns the handler's count. */
export async function runBusinessSweep(
  job: BusinessSweepJob,
  now: Date = new Date(),
  deps?: HandlerDeps,
  database: Db = defaultDb,
): Promise<number> {
  const [biz] = await database
    .select({
      id: businesses.id,
      name: businesses.name,
      timezone: businesses.timezone,
      leadDays: businesses.certReminderLeadDays,
      staffShiftRemindersEnabled: businesses.staffShiftRemindersEnabled,
      formDigestEnabled: businesses.formDigestEnabled,
      formDigestLastAt: businesses.formDigestLastAt,
    })
    .from(businesses)
    .where(eq(businesses.id, job.businessId));
  if (!biz) {
    logger.warn(
      { businessId: job.businessId, kind: job.kind },
      "Business sweep skipped: business no longer exists",
    );
    return 0;
  }

  const kind: SweepKind = job.kind;
  const log = logger.child({
    businessId: biz.id,
    kind,
    runDate: job.runDate,
  });
  let count: number;
  switch (kind) {
    case "certReminder":
      count = await remindCertificationsForBusiness(biz, now, deps);
      break;
    case "orderReminder":
      count = await remindOrdersForBusiness(biz, now, deps);
      break;
    case "formResponseDigest":
      count = (await sendFormDigestForBusiness(
        {
          id: biz.id,
          name: biz.name,
          enabled: biz.formDigestEnabled,
          lastAt: biz.formDigestLastAt,
        },
        now,
        deps,
      ))
        ? 1
        : 0;
      break;
    case "staffShiftReminder":
      count = await remindShiftsForBusiness(
        {
          id: biz.id,
          timezone: biz.timezone,
          enabled: biz.staffShiftRemindersEnabled,
        },
        now,
      );
      break;
    case "photoRetention":
      count = await purgePhotosForBusiness(biz, now);
      break;
    case "staffLoanExpiry":
      count = await expireLoansForBusiness(biz, now);
      break;
  }
  log.info({ count }, "Business sweep complete");
  return count;
}
