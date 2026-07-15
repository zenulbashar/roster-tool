import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organisations, businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo, type OrgRepo } from "@/lib/tenant/org-repository";

/**
 * M29 Phase 3: staff-initiated cross-location shift cover. A shift at location A
 * is offered org-wide; a staff member whose home is location B claims it from
 * their own location, and the owner's approval transfers it — granting the
 * claimer a membership at A so they can work + clock in there. Plus cross-org
 * isolation and the can't-claim-your-own guard.
 */
describe("cross-location shift swap (Phase 3)", () => {
  let org = "";
  let bizA = "";
  let bizB = "";
  let orgX = "";
  let bizX = "";
  let repoA: TenantRepo;
  let orgRepo: OrgRepo;
  let orgRepoX: OrgRepo;
  let ada = ""; // home A, releases the shift
  let ben = ""; // home B, covers it cross-location
  let evan = ""; // home in another org — must never be able to claim
  let shiftId = "";
  let offerId = "";

  beforeAll(async () => {
    const [o] = await db
      .insert(organisations)
      .values({ name: "Cover Org" })
      .returning();
    org = o!.id;
    const [a] = await db
      .insert(businesses)
      .values({ name: "Downtown", orgId: org })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Airport", orgId: org })
      .returning();
    bizA = a!.id;
    bizB = b!.id;
    repoA = createTenantRepo(bizA);
    orgRepo = createOrgRepo(org);

    const [ox] = await db
      .insert(organisations)
      .values({ name: "Rival Org" })
      .returning();
    orgX = ox!.id;
    const [bx] = await db
      .insert(businesses)
      .values({ name: "Rival Cafe", orgId: orgX })
      .returning();
    bizX = bx!.id;
    orgRepoX = createOrgRepo(orgX);

    ada = (await repoA.addStaff({ name: "Ada", email: "ada@dt.test" })).id;
    ben = (
      await createTenantRepo(bizB).addStaff({
        name: "Ben",
        email: "ben@ap.test",
      })
    ).id;
    evan = (
      await createTenantRepo(bizX).addStaff({ name: "Evan", email: "e@x.test" })
    ).id;

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
    ]);
    shiftId = shifts[0]!.id;
    await repoA.publish(period.id, "cover-slug-a");
    await repoA.assign(shiftId, ada);
  });

  afterAll(async () => {
    for (const id of [org, orgX]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    await db.$client.end();
  });

  it("offers a shift org-wide and surfaces it to other locations", async () => {
    const res = await repoA.releaseOwnShift(ada, shiftId, "org");
    expect(res.ok).toBe(true);
    offerId = res.ok ? res.offer.id : "";
    // Releaser stays covered until approval.
    expect(await repoA.hasConfirmedAssignment(ada, shiftId)).toBe(true);

    // From Airport (Ben's home) the Downtown shift shows as coverable, tagged
    // with its location.
    const forBen = await orgRepo.listOrgOpenOffers({
      excludeBusinessId: bizB,
      excludeStaffId: ben,
    });
    const seen = forBen.find((o) => o.offerId === offerId);
    expect(seen).toBeTruthy();
    expect(seen?.locationName).toBe("Downtown");

    // The releaser never sees their own offer to claim.
    const forAda = await orgRepo.listOrgOpenOffers({ excludeStaffId: ada });
    expect(forAda.some((o) => o.offerId === offerId)).toBe(false);
  });

  it("blocks claims from another org and self-claims", async () => {
    // Evan is in another org: neither his org repo nor ours can claim it for him.
    expect((await orgRepoX.claimOrgOffer(offerId, evan)).ok).toBe(false);
    expect((await orgRepo.claimOrgOffer(offerId, evan)).ok).toBe(false);
    // Ada can't claim the shift she offered up.
    expect((await orgRepo.claimOrgOffer(offerId, ada)).ok).toBe(false);
    // Still open after the failed attempts.
    expect((await orgRepo.getOrgOffer(offerId))?.status).toBe("open");
  });

  it("lets a member of another location claim it", async () => {
    const res = await orgRepo.claimOrgOffer(offerId, ben);
    expect(res.ok).toBe(true);
    expect(res.ok && res.businessId).toBe(bizA);
    expect((await orgRepo.getOrgOffer(offerId))?.status).toBe("claimed");

    // Before approval Ben isn't yet a member of Downtown.
    expect(await repoA.getStaff(ben)).toBeNull();
  });

  it("transfers the shift on owner approval, granting a home-away membership", async () => {
    const res = await repoA.approveOffer(offerId);
    expect(res.ok).toBe(true);

    // Ben is now an active member of Downtown and can be seen/rostered there.
    expect((await repoA.getStaff(ben))?.id).toBe(ben);
    expect((await repoA.listStaff()).some((s) => s.id === ben)).toBe(true);

    // The handover happened: Ben confirmed on the shift, Ada removed.
    expect(await repoA.hasConfirmedAssignment(ben, shiftId)).toBe(true);
    expect(await repoA.hasConfirmedAssignment(ada, shiftId)).toBe(false);

    // The offer no longer shows as open anywhere in the org.
    const open = await orgRepo.listOrgOpenOffers({});
    expect(open.some((o) => o.offerId === offerId)).toBe(false);
  });
});
