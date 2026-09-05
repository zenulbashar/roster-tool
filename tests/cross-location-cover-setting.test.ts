import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { releaseShiftForStaff } from "@/lib/shift-offer-submission";
import { hashPin } from "@/lib/pin";
import { makeOrgWithTwoLocations, type TwoLocationOrg } from "./helpers/org";

/**
 * PROD-15 — cross-location shift cover is an owner SETTING per location plus
 * a per-release CHOICE, not an automatic consequence of having two venues.
 * The tenant repo is the single authority: a requested `org` scope is
 * honoured only where the owner allows it (and another location exists), for
 * both a staff release and an owner-posted open shift.
 */
describe("cross-location cover setting (PROD-15)", () => {
  const PIN = "4826";
  let org: TwoLocationOrg;
  let repoA: TenantRepo;
  let ada = "";
  let assignedShift = "";
  let emptyShift = "";

  beforeAll(async () => {
    org = await makeOrgWithTwoLocations({ prefix: "ccover" });
    repoA = createTenantRepo(org.bizA);
    const staff = await repoA.addStaff({
      name: "Ada",
      email: "ada@ccover.test",
    });
    ada = staff.id;
    await repoA.setStaffPin(ada, await hashPin(PIN));

    const period = await repoA.createPeriod({
      label: "Cover week",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    const shifts = await repoA.createShifts([
      {
        rosterPeriodId: period.id,
        date: "2026-06-10",
        label: "Morning",
        startTime: "09:00",
        endTime: "12:00",
      },
      {
        rosterPeriodId: period.id,
        date: "2026-06-11",
        label: "Arvo",
        startTime: "13:00",
        endTime: "17:00",
      },
    ]);
    assignedShift = shifts[0]!.id;
    emptyShift = shifts[1]!.id;
    await repoA.publish(period.id, "ccover-slug-a");
    await repoA.assign(assignedShift, ada);
  });

  afterAll(async () => {
    await org.cleanup();
    await db.$client.end();
  });

  async function withdrawActive(shiftId: string) {
    const offer = await repoA.getActiveOfferForShift(shiftId);
    if (offer) await repoA.withdrawOffer(offer.id);
  }

  it("is OFF by default: an org-scoped request stays local and never reaches the other location", async () => {
    expect(await repoA.getCrossLocationCoverEnabled()).toBe(false);

    const released = await repoA.releaseOwnShift(ada, assignedShift, "org");
    expect(released.ok).toBe(true);
    expect(released.ok && released.offer.scope).toBe("location");

    const seenFromB = await createOrgRepo(org.orgId).listOrgOpenOffers({
      excludeBusinessId: org.bizB,
    });
    expect(
      seenFromB.some((o) => released.ok && o.offerId === released.offer.id),
    ).toBe(false);
    await withdrawActive(assignedShift);

    // The owner's open-shift post is gated the same way.
    const posted = await repoA.postOpenShift(emptyShift, "org");
    expect(posted.ok && posted.offer.scope).toBe("location");
    await withdrawActive(emptyShift);
  });

  it("when ON, an org-scoped request is honoured for releases and open shifts", async () => {
    await repoA.updateBusinessSettings({ allowCrossLocationCover: true });
    expect(await repoA.getCrossLocationCoverEnabled()).toBe(true);

    const released = await repoA.releaseOwnShift(ada, assignedShift, "org");
    expect(released.ok && released.offer.scope).toBe("org");
    const seenFromB = await createOrgRepo(org.orgId).listOrgOpenOffers({
      excludeBusinessId: org.bizB,
    });
    expect(
      seenFromB.some((o) => released.ok && o.offerId === released.offer.id),
    ).toBe(true);
    await withdrawActive(assignedShift);

    const posted = await repoA.postOpenShift(emptyShift, "org");
    expect(posted.ok && posted.offer.scope).toBe("org");
    await withdrawActive(emptyShift);

    // A local request stays local even when cover is allowed.
    const local = await repoA.releaseOwnShift(ada, assignedShift, "location");
    expect(local.ok && local.offer.scope).toBe("location");
    await withdrawActive(assignedShift);
  });

  it("the staff member's per-release choice decides the reach (setting on)", async () => {
    const form = (coverElsewhere: boolean) => {
      const fd = new FormData();
      fd.set("staffId", ada);
      fd.set("pin", PIN);
      fd.set("shiftId", assignedShift);
      if (coverElsewhere) fd.set("coverElsewhere", "1");
      return fd;
    };

    const wide = await releaseShiftForStaff(repoA, form(true));
    expect(wide.status).toBe("success");
    expect((await repoA.getActiveOfferForShift(assignedShift))?.scope).toBe(
      "org",
    );
    await withdrawActive(assignedShift);

    const venueOnly = await releaseShiftForStaff(repoA, form(false));
    expect(venueOnly.status).toBe("success");
    expect((await repoA.getActiveOfferForShift(assignedShift))?.scope).toBe(
      "location",
    );
    await withdrawActive(assignedShift);

    // Ticking the box means nothing once the owner turns the setting off.
    await repoA.updateBusinessSettings({ allowCrossLocationCover: false });
    const ignored = await releaseShiftForStaff(repoA, form(true));
    expect(ignored.status).toBe("success");
    expect((await repoA.getActiveOfferForShift(assignedShift))?.scope).toBe(
      "location",
    );
    await withdrawActive(assignedShift);
  });

  it("has no effect for a single-location business even when switched on", async () => {
    const [only] = await db
      .insert(businesses)
      .values({ name: "Solo Cafe", allowCrossLocationCover: true })
      .returning();
    try {
      const repoSolo = createTenantRepo(only!.id);
      expect(await repoSolo.getCrossLocationCoverEnabled()).toBe(false);
    } finally {
      await db.delete(businesses).where(eq(businesses.id, only!.id));
    }
  });
});
