import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, jobDispatches } from "@/lib/db/schema";
import { dispatchDailySweeps, runBusinessSweep } from "@/lib/jobs/sweeps";
import type { BusinessSweepJob } from "@/lib/jobs/queues";

/**
 * PERF-02 / PERF-03 — the dispatcher against Postgres: one job per tenant per
 * sweep per LOCAL day, at each tenant's own send hour; exactly once across
 * ticks (a second tick in the same local day enqueues nothing); a failed
 * enqueue releases the claim; and the per-business job runs the right
 * handler for the right tenant. pg-boss itself is not involved — the enqueue
 * is injected — so this is the fan-out logic, not the queue.
 */
describe("daily sweep dispatch (flow)", () => {
  let sydney = "";
  let london = "";
  const mine = () => [sydney, london];

  beforeAll(async () => {
    const [s] = await db
      .insert(businesses)
      .values({ name: "Dispatch Sydney", timezone: "Australia/Sydney" })
      .returning();
    const [l] = await db
      .insert(businesses)
      .values({ name: "Dispatch London", timezone: "Europe/London" })
      .returning();
    sydney = s!.id;
    london = l!.id;
  });

  afterAll(async () => {
    await db.delete(businesses).where(inArray(businesses.id, mine()));
    await db.$client.end();
  });

  function collector() {
    const jobs: BusinessSweepJob[] = [];
    const enqueue = vi.fn(async (job: BusinessSweepJob) => {
      if (mine().includes(job.businessId)) jobs.push(job);
    });
    return { jobs, enqueue };
  }

  const kindsFor = (jobs: BusinessSweepJob[], id: string) =>
    jobs
      .filter((j) => j.businessId === id)
      .map((j) => j.kind)
      .sort();

  it("enqueues each tenant's sweeps at ITS local hour, once per local day", async () => {
    // 20:30Z: Sydney 06:30 AEST (digest 7 not yet; maintenance hours 1/3 are);
    // London 21:30 BST (everything is at-or-past).
    const t1 = new Date("2026-09-04T20:30:00Z");
    const c1 = collector();
    const summary = await dispatchDailySweeps(t1, c1.enqueue, db, {
      businessIds: mine(),
    });
    expect(summary.scanned).toBe(2);
    expect(kindsFor(c1.jobs, sydney)).toEqual([
      "photoRetention",
      "staffLoanExpiry",
    ]);
    expect(kindsFor(c1.jobs, london)).toEqual(
      [
        "certReminder",
        "orderReminder",
        "formResponseDigest",
        "staffShiftReminder",
        "photoRetention",
        "staffLoanExpiry",
      ].sort(),
    );
    const sydneyJob = c1.jobs.find(
      (j) => j.businessId === sydney && j.kind === "photoRetention",
    )!;
    expect(sydneyJob.runDate).toBe("2026-09-05"); // Sydney is already on the 5th
    expect(
      c1.jobs.find((j) => j.businessId === london && j.kind === "certReminder")!
        .runDate,
    ).toBe("2026-09-04");

    // The same tick again (or the next hour before the digest hour): nothing new.
    const c2 = collector();
    await dispatchDailySweeps(
      new Date("2026-09-04T20:45:00Z"),
      c2.enqueue,
      db,
      { businessIds: mine() },
    );
    expect(c2.jobs).toEqual([]);

    // 22:30Z: Sydney reaches 08:30 → the digests are due; London gets nothing new.
    const c3 = collector();
    await dispatchDailySweeps(
      new Date("2026-09-04T22:30:00Z"),
      c3.enqueue,
      db,
      { businessIds: mine() },
    );
    expect(kindsFor(c3.jobs, sydney)).toEqual(
      ["certReminder", "orderReminder", "formResponseDigest"].sort(),
    );
    expect(kindsFor(c3.jobs, london)).toEqual([]);

    // The ledger holds exactly one row per (kind, business, local date).
    const rows = await db
      .select()
      .from(jobDispatches)
      .where(inArray(jobDispatches.businessId, mine()));
    const keys = rows.map((r) => `${r.kind}:${r.businessId}:${r.runDate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.filter((r) => r.businessId === sydney)).toHaveLength(5);
    expect(rows.filter((r) => r.businessId === london)).toHaveLength(6);
  });

  it("a new local day re-arms every sweep", async () => {
    const c = collector();
    // Next day, 23:30Z: Sydney 09:30 on the 6th, London 00:30 on the 5th.
    await dispatchDailySweeps(new Date("2026-09-05T23:30:00Z"), c.enqueue, db, {
      businessIds: mine(),
    });
    expect(kindsFor(c.jobs, sydney)).toEqual(
      [
        "certReminder",
        "orderReminder",
        "formResponseDigest",
        "photoRetention",
        "staffLoanExpiry",
      ].sort(),
    );
    // London at 00:30: only the 00:xx-eligible sweep (loan expiry at 1? no —
    // hour 0 < 1), so nothing yet on the 5th.
    expect(kindsFor(c.jobs, london)).toEqual([]);
  });

  it("releases the claim when the enqueue fails, so the next tick retries", async () => {
    const failing = vi.fn(async (job: BusinessSweepJob) => {
      if (job.businessId === sydney && job.kind === "staffShiftReminder") {
        throw new Error("queue down");
      }
    });
    // Sydney 17:30 on the 6th → the shift reminder is due for the first time.
    const t = new Date("2026-09-06T07:30:00Z");
    await expect(
      dispatchDailySweeps(t, failing, db, { businessIds: mine() }),
    ).rejects.toThrow("queue down");
    const claim = await db
      .select()
      .from(jobDispatches)
      .where(
        and(
          eq(jobDispatches.businessId, sydney),
          eq(jobDispatches.kind, "staffShiftReminder"),
          eq(jobDispatches.runDate, "2026-09-06"),
        ),
      );
    expect(claim).toHaveLength(0);

    const c = collector();
    await dispatchDailySweeps(t, c.enqueue, db, { businessIds: mine() });
    expect(kindsFor(c.jobs, sydney)).toContain("staffShiftReminder");
  });

  it("runs the right per-business handler for a job, and skips a vanished business", async () => {
    const send = vi.fn(async () => {});
    expect(
      await runBusinessSweep(
        { kind: "certReminder", businessId: sydney, runDate: "2026-09-05" },
        new Date("2026-09-04T22:30:00Z"),
        { send },
      ),
    ).toBe(0); // no owner / no certs → nothing sent, no throw
    expect(send).not.toHaveBeenCalled();
    expect(
      await runBusinessSweep(
        { kind: "photoRetention", businessId: london, runDate: "2026-09-04" },
        new Date("2026-09-04T20:30:00Z"),
      ),
    ).toBe(0);
    expect(
      await runBusinessSweep(
        {
          kind: "staffShiftReminder",
          businessId: sydney,
          runDate: "2026-09-06",
        },
        new Date("2026-09-06T07:30:00Z"),
      ),
    ).toBe(0);
    expect(
      await runBusinessSweep({
        kind: "staffLoanExpiry",
        businessId: "00000000-0000-0000-0000-000000000000",
        runDate: "2026-09-04",
      }),
    ).toBe(0);
  });
});
