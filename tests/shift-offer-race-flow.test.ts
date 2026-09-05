import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";

/**
 * COR-10 regression guard: two concurrent approvals of the same claimed offer
 * (a double-click, or two managers) must yield exactly ONE approval and one
 * refusal — never an `{ ok: true, offer: undefined }` that crashes the caller.
 */
describe("shift offer approval race (COR-10)", () => {
  let businessId = "";
  let repo: TenantRepo;
  let ava = "";
  let ben = "";
  let shiftId = "";

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Race Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
    ava = (await repo.addStaff({ name: "Ava", email: "ava@race.test" })).id;
    ben = (await repo.addStaff({ name: "Ben", email: "ben@race.test" })).id;
    const period = await repo.createPeriod({
      label: "Race week",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    const [shift] = await repo.createShifts([
      {
        rosterPeriodId: period.id,
        date: "2026-06-10",
        label: "Morning",
        startTime: "09:00",
        endTime: "12:00",
      },
    ]);
    shiftId = shift!.id;
    await repo.publish(period.id, "race-slug");
    await repo.assign(shiftId, ava);
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
  });

  it("serialises concurrent approvals: one wins, the other is refused, nobody crashes", async () => {
    const released = await repo.releaseOwnShift(ava, shiftId);
    expect(released.ok).toBe(true);
    const claimed = await repo.claimOffer(released.offer!.id, ben);
    expect(claimed.ok).toBe(true);
    const offerId = released.offer!.id;

    // Fire both approvals at once. With the row lock the second waits, then
    // sees `approved` and is refused with a reason (not an assertion crash).
    const results = await Promise.all([
      repo.approveOffer(offerId),
      repo.approveOffer(offerId),
    ]);
    const wins = results.filter((r) => r.ok);
    const refusals = results.filter((r) => !r.ok);
    expect(wins.length).toBe(1);
    expect(refusals.length).toBe(1);
    // The winner carries the approved offer row — never undefined.
    expect(wins[0]!.ok && wins[0]!.offer.status).toBe("approved");

    // The transfer happened exactly once: Ben is on the shift, Ava is off it.
    const rows = await repo.rosterRows(
      (await repo.getShift(shiftId))!.rosterPeriodId,
    );
    const onShift = rows
      .filter((r) => r.shiftId === shiftId)
      .map((r) => r.staffMemberId);
    expect(onShift).toEqual([ben]);
  });
});
