import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { zonedDateTimeToUtc } from "@/lib/time";
import { aggregateLabour, resolveWindow } from "@/lib/labour-report";

/**
 * Integration coverage for the labour report's data layer: the tenant-scoped,
 * windowed read (`listEntriesForLabourReport`) feeding the pure aggregator.
 * Requires a local Postgres (see CI / README). Read-only — no new writes.
 */
const TZ = "Australia/Sydney";

describe("labour report flow", () => {
  let businessA = "";
  let businessB = "";

  // A custom one-week window: 08/06–14/06 (Sydney-local).
  const window = resolveWindow("custom", {
    today: "2026-06-10",
    from: "2026-06-08",
    to: "2026-06-14",
  });
  const startUtc = zonedDateTimeToUtc(window.startDate, "00:00", TZ);
  const endUtc = zonedDateTimeToUtc(window.endDate, "00:00", TZ);

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Report Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Report Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;

    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);

    const ava = await repoA.addStaff({ name: "Ava", email: "ava@a.test" });
    await repoA.updateStaff(ava.id, { payRateCents: 2500 });
    const ben = await repoA.addStaff({ name: "Ben", email: "ben@a.test" }); // no rate
    const zoe = await repoB.addStaff({ name: "Zoe", email: "zoe@b.test" });
    await repoB.updateStaff(zoe.id, { payRateCents: 9999 });

    // Helper: a closed (and optionally approved) entry for a staff member.
    const logShift = async (
      repo: ReturnType<typeof createTenantRepo>,
      staffId: string,
      inAt: string,
      outAt: string,
      approved: boolean,
    ) => {
      const entry = await repo.clockIn(staffId, { at: new Date(inAt) });
      await repo.clockOut(entry.id, new Date(outAt));
      if (approved) await repo.setEntryApproved(entry.id, true);
      return entry;
    };

    // Ava: approved 8h (in window), pending 4h (in window), approved 5h (BEFORE window).
    await logShift(
      repoA,
      ava.id,
      "2026-06-09T00:00:00Z",
      "2026-06-09T08:00:00Z",
      true,
    );
    await logShift(
      repoA,
      ava.id,
      "2026-06-10T00:00:00Z",
      "2026-06-10T04:00:00Z",
      false,
    );
    await logShift(
      repoA,
      ava.id,
      "2026-06-01T00:00:00Z",
      "2026-06-01T05:00:00Z",
      true,
    );
    // Ben (no rate): approved 6h in window.
    await logShift(
      repoA,
      ben.id,
      "2026-06-09T01:00:00Z",
      "2026-06-09T07:00:00Z",
      true,
    );
    // Zoe in business B: approved 10h in the same window.
    await logShift(
      repoB,
      zoe.id,
      "2026-06-09T00:00:00Z",
      "2026-06-09T10:00:00Z",
      true,
    );
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("returns only this business's in-window entries (tenant + window scoped)", async () => {
    const repoA = createTenantRepo(businessA);
    const rows = await repoA.listEntriesForLabourReport(startUtc, endUtc);

    // Ava's two in-window entries + Ben's one. The pre-window 5h is excluded;
    // business B's Zoe never appears.
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.staffName === "Zoe")).toBe(false);
    expect(rows.filter((r) => r.staffName === "Ava")).toHaveLength(2);
    // Rate fields come through the join.
    expect(rows.find((r) => r.staffName === "Ava")?.payRateCents).toBe(2500);
    expect(rows.find((r) => r.staffName === "Ben")?.payRateCents).toBeNull();
  });

  it("aggregates approved-only cost, splits pending hours, flags no-rate staff", async () => {
    const repoA = createTenantRepo(businessA);
    const rows = await repoA.listEntriesForLabourReport(startUtc, endUtc);
    const report = aggregateLabour(rows, window, TZ);

    const ava = report.perStaff.find((s) => s.staffName === "Ava")!;
    expect(ava.approvedHours).toBe(8);
    expect(ava.pendingHours).toBe(4);
    expect(ava.estCostCents).toBe(8 * 2500); // pending 4h not costed

    const ben = report.perStaff.find((s) => s.staffName === "Ben")!;
    expect(ben.approvedHours).toBe(6);
    expect(ben.hasRate).toBe(false);
    expect(ben.estCostCents).toBeNull();

    expect(report.totals.estCostCents).toBe(20000);
    expect(report.totals.staffWithoutRateCount).toBe(1);
  });

  it("scopes to business B independently", async () => {
    const repoB = createTenantRepo(businessB);
    const rows = await repoB.listEntriesForLabourReport(startUtc, endUtc);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.staffName).toBe("Zoe");
  });
});
