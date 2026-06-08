import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, publishedRosters } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { timesOverlap } from "@/lib/shift-offer";

/**
 * Integration coverage of the shift-offer lifecycle against the real DB:
 * release (assignment stays put), one-claimant-at-a-time, the transactional
 * transfer on approve, deny/withdraw, owner-posted open shifts, the approve
 * guard when a roster is unpublished, conflict flagging, and tenant isolation.
 */
describe("shift swap flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let periodA = "";
  let ava = "";
  let ben = "";
  let cara = "";
  let danB = "";
  // shift ids created per scenario
  let morningShift = "";
  let midShift = "";
  let openShift = "";
  let denyShift = "";

  const DATE1 = "2026-06-10";
  const DATE2 = "2026-06-11";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Swap Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Swap Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);

    ava = (await repoA.addStaff({ name: "Ava", email: "ava@a.test" })).id;
    ben = (await repoA.addStaff({ name: "Ben", email: "ben@a.test" })).id;
    cara = (await repoA.addStaff({ name: "Cara", email: "cara@a.test" })).id;
    danB = (await repoB.addStaff({ name: "Dan", email: "dan@b.test" })).id;

    const period = await repoA.createPeriod({
      label: "Swap week",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    periodA = period.id;

    const shifts = await repoA.createShifts([
      {
        rosterPeriodId: periodA,
        date: DATE1,
        label: "Morning",
        startTime: "09:00",
        endTime: "12:00",
      },
      {
        rosterPeriodId: periodA,
        date: DATE1,
        label: "Mid",
        startTime: "11:00",
        endTime: "14:00",
      },
      {
        rosterPeriodId: periodA,
        date: DATE2,
        label: "Open one",
        startTime: "09:00",
        endTime: "12:00",
      },
      {
        rosterPeriodId: periodA,
        date: DATE2,
        label: "Deny one",
        startTime: "13:00",
        endTime: "17:00",
      },
    ]);
    morningShift = shifts[0]!.id; // Ava
    midShift = shifts[1]!.id; // Ben (overlaps morning on DATE1)
    openShift = shifts[2]!.id; // unassigned, for owner post
    denyShift = shifts[3]!.id; // Cara, for deny

    await repoA.publish(periodA, "swap-slug-a");
    await repoA.assign(morningShift, ava);
    await repoA.assign(midShift, ben);
    await repoA.assign(denyShift, cara);
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("release creates an open offer and leaves the original assignment intact", async () => {
    const res = await repoA.releaseOwnShift(ava, morningShift);
    expect(res.ok).toBe(true);
    // The original assignee stays covered.
    expect(await repoA.hasConfirmedAssignment(ava, morningShift)).toBe(true);
    const active = await repoA.getActiveOfferForShift(morningShift);
    expect(active?.status).toBe("open");
    expect(active?.offeredByStaffId).toBe(ava);
  });

  it("blocks a second active offer on the same shift", async () => {
    const res = await repoA.releaseOwnShift(ava, morningShift);
    expect(res.ok).toBe(false);
  });

  it("rejects releasing a shift you don't hold", async () => {
    const res = await repoA.releaseOwnShift(ben, morningShift);
    expect(res.ok).toBe(false);
  });

  it("allows one claimant at a time; can't claim your own offer", async () => {
    const offer = (await repoA.getActiveOfferForShift(morningShift))!;
    // Ava offered it — she can't claim it.
    const ownClaim = await repoA.claimOffer(offer.id, ava);
    expect(ownClaim.ok).toBe(false);

    // Cara claims it.
    const claim = await repoA.claimOffer(offer.id, cara);
    expect(claim.ok).toBe(true);

    // Ben can't claim it now (already claimed).
    const second = await repoA.claimOffer(offer.id, ben);
    expect(second.ok).toBe(false);
  });

  it("approve transfers the assignment (claimer in, releaser out) and finalises", async () => {
    const offer = (await repoA.getActiveOfferForShift(morningShift))!;
    expect(offer.status).toBe("claimed");

    const res = await repoA.approveOffer(offer.id);
    expect(res.ok).toBe(true);

    // Handover: Cara is now on the shift, Ava is off it.
    expect(await repoA.hasConfirmedAssignment(cara, morningShift)).toBe(true);
    expect(await repoA.hasConfirmedAssignment(ava, morningShift)).toBe(false);

    const finalized = await repoA.getOffer(offer.id);
    expect(finalized?.status).toBe("approved");
    expect(finalized?.decidedAt).toBeInstanceOf(Date);

    // No active offer remains, so the shift can be offered again.
    expect(await repoA.getActiveOfferForShift(morningShift)).toBeNull();
  });

  it("deny leaves the original assignment unchanged", async () => {
    const offer = (await repoA.releaseOwnShift(cara, denyShift)).ok
      ? (await repoA.getActiveOfferForShift(denyShift))!
      : null;
    expect(offer).not.toBeNull();
    await repoA.claimOffer(offer!.id, ben);

    const denied = await repoA.denyOffer(offer!.id);
    expect(denied?.status).toBe("denied");
    // Cara still holds it; Ben was not assigned.
    expect(await repoA.hasConfirmedAssignment(cara, denyShift)).toBe(true);
    expect(await repoA.hasConfirmedAssignment(ben, denyShift)).toBe(false);
  });

  it("owner posts an open shift (offered_by null); approve assigns with nothing to unassign", async () => {
    const post = await repoA.postOpenShift(openShift);
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    expect(post.offer.offeredByStaffId).toBeNull();

    // Can't post an open shift twice.
    expect((await repoA.postOpenShift(openShift)).ok).toBe(false);

    await repoA.claimOffer(post.offer.id, ava);
    const res = await repoA.approveOffer(post.offer.id);
    expect(res.ok).toBe(true);
    expect(await repoA.hasConfirmedAssignment(ava, openShift)).toBe(true);
  });

  it("withdraw works on an open offer; staff self-cancel only their own", async () => {
    // Create a fresh shift to offer.
    const [extra] = await repoA.createShifts([
      {
        rosterPeriodId: periodA,
        date: DATE2,
        label: "Extra",
        startTime: "08:00",
        endTime: "10:00",
      },
    ]);
    await repoA.assign(extra!.id, ben);
    const offer = (await repoA.releaseOwnShift(ben, extra!.id)).ok
      ? (await repoA.getActiveOfferForShift(extra!.id))!
      : null;
    expect(offer).not.toBeNull();

    // Cara can't self-cancel Ben's offer.
    expect(
      await repoA.withdrawOffer(offer!.id, { byStaffId: cara }),
    ).toBeNull();
    // Ben can.
    const w = await repoA.withdrawOffer(offer!.id, { byStaffId: ben });
    expect(w?.status).toBe("withdrawn");
    // Ben still holds the shift (withdraw never touches the assignment).
    expect(await repoA.hasConfirmedAssignment(ben, extra!.id)).toBe(true);
  });

  it("refuses to approve when the roster is no longer published", async () => {
    const period = await repoA.createPeriod({
      label: "Unpub week",
      startDate: "2026-07-06",
      endDate: "2026-07-12",
    });
    const [shift] = await repoA.createShifts([
      {
        rosterPeriodId: period.id,
        date: "2026-07-07",
        label: "X",
        startTime: "09:00",
        endTime: "12:00",
      },
    ]);
    await repoA.publish(period.id, "unpub-slug");
    await repoA.assign(shift!.id, ava);
    const offer = (await repoA.releaseOwnShift(ava, shift!.id)) as {
      ok: true;
      offer: { id: string };
    };
    await repoA.claimOffer(offer.offer.id, cara);

    // Unpublish underneath.
    await db
      .delete(publishedRosters)
      .where(eq(publishedRosters.rosterPeriodId, period.id));

    const res = await repoA.approveOffer(offer.offer.id);
    expect(res.ok).toBe(false);
    // No transfer happened.
    expect(await repoA.hasConfirmedAssignment(ava, shift!.id)).toBe(true);
    expect(await repoA.hasConfirmedAssignment(cara, shift!.id)).toBe(false);
  });

  it("flags leave and same-day overlap conflicts (without blocking)", async () => {
    // Cara has approved leave on DATE1.
    await repoA.createLeaveRequest({
      staffMemberId: cara,
      leaveType: "annual",
      startDate: DATE1,
      endDate: DATE1,
      status: "approved",
      decidedAt: new Date(),
    });
    expect(await repoA.hasApprovedLeaveOn(cara, DATE1)).toBe(true);
    expect(await repoA.hasApprovedLeaveOn(ben, DATE1)).toBe(false);

    // Ben is confirmed on midShift (11:00–14:00) on DATE1; that overlaps a
    // 09:00–12:00 morning shift on the same day.
    const sameDay = await repoA.confirmedShiftsForStaffOnDate(
      ben,
      DATE1,
      openShift,
    );
    expect(sameDay.some((x) => x.shiftId === midShift)).toBe(true);
    expect(
      sameDay.some((x) =>
        timesOverlap("09:00", "12:00", x.startTime, x.endTime),
      ),
    ).toBe(true);
  });

  it("isolates offers across tenants", async () => {
    const [shift] = await repoA.createShifts([
      {
        rosterPeriodId: periodA,
        date: DATE2,
        label: "Iso",
        startTime: "15:00",
        endTime: "18:00",
      },
    ]);
    await repoA.assign(shift!.id, ava);
    const offer = (await repoA.releaseOwnShift(ava, shift!.id)) as {
      ok: true;
      offer: { id: string };
    };
    const id = offer.offer.id;

    // B can't see or act on A's offer.
    expect(await repoB.getOffer(id)).toBeNull();
    expect((await repoB.claimOffer(id, danB)).ok).toBe(false);
    expect((await repoB.approveOffer(id)).ok).toBe(false);
    expect(await repoB.denyOffer(id)).toBeNull();
    expect(await repoB.withdrawOffer(id)).toBeNull();
    // And B can't release A's shift.
    expect((await repoB.releaseOwnShift(danB, shift!.id)).ok).toBe(false);

    // A's offer is untouched.
    expect((await repoA.getOffer(id))?.status).toBe("open");
  });
});
