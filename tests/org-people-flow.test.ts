import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organisations, businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";

/**
 * M29 Phase 2: the shared org-wide staff pool + cross-location membership. A
 * person added at one location is invisible at another until the owner grants a
 * `staff_location` membership — at which point they can be rostered there. Also
 * checks cross-org isolation (N3) and the home-location remove guard.
 */
describe("M29 org people + cross-location membership (Phase 2)", () => {
  let org = "";
  let bizA = "";
  let bizB = "";
  let orgX = "";
  let bizX = "";
  let personId = "";

  beforeAll(async () => {
    const [o] = await db
      .insert(organisations)
      .values({ name: "People Org" })
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

    const [ox] = await db
      .insert(organisations)
      .values({ name: "Other Org" })
      .returning();
    orgX = ox!.id;
    const [bx] = await db
      .insert(businesses)
      .values({ name: "Rival Cafe", orgId: orgX })
      .returning();
    bizX = bx!.id;
  });

  afterAll(async () => {
    for (const id of [org, orgX]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    await db.$client.end();
  });

  it("adds a person at their home location with an org + membership", async () => {
    const repoA = createTenantRepo(bizA);
    const person = await repoA.addStaff({ name: "Ada", email: "ada@dt.test" });
    personId = person.id;
    expect(person.orgId).toBe(org);
    expect(person.businessId).toBe(bizA);

    // Visible at home A, invisible at B (no membership there yet).
    const aList = await repoA.listStaff();
    expect(aList.some((s) => s.id === personId)).toBe(true);

    const repoB = createTenantRepo(bizB);
    const bList = await repoB.listStaff();
    expect(bList.some((s) => s.id === personId)).toBe(false);
    // ...and can't be fetched/rostered at B.
    expect(await repoB.getStaff(personId)).toBeNull();
  });

  it("becomes rosterable at another location once made a member", async () => {
    const orgRepo = createOrgRepo(org);
    const res = await orgRepo.addPersonToLocation(personId, bizB);
    expect(res.ok).toBe(true);

    const repoB = createTenantRepo(bizB);
    const bList = await repoB.listStaff();
    expect(bList.some((s) => s.id === personId)).toBe(true);
    // getStaff now resolves at B, so the roster builder / PIN flow can use them.
    expect((await repoB.getStaff(personId))?.id).toBe(personId);
  });

  it("lists people org-wide with all their locations", async () => {
    const people = await createOrgRepo(org).listPeople();
    const ada = people.find((p) => p.id === personId);
    expect(ada?.locationIds).toContain(bizA);
    expect(ada?.locationIds).toContain(bizB);
  });

  it("removes a non-home membership but guards the home location", async () => {
    const orgRepo = createOrgRepo(org);

    const removed = await orgRepo.removePersonFromLocation(personId, bizB);
    expect(removed.ok).toBe(true);
    const repoB = createTenantRepo(bizB);
    expect((await repoB.listStaff()).some((s) => s.id === personId)).toBe(
      false,
    );

    // Home can't be removed (they'd vanish from their base).
    const home = await orgRepo.removePersonFromLocation(personId, bizA);
    expect(home.ok).toBe(false);
    expect(home.reason).toBe("home");
    // Still at home A.
    expect(
      (await createTenantRepo(bizA).listStaff()).some((s) => s.id === personId),
    ).toBe(true);
  });

  it("refuses cross-org membership either direction (N3)", async () => {
    const orgRepo = createOrgRepo(org);
    // Our person can't be placed at another org's location.
    expect((await orgRepo.addPersonToLocation(personId, bizX)).ok).toBe(false);

    // Another org can't grab our person.
    const orgRepoX = createOrgRepo(orgX);
    expect((await orgRepoX.addPersonToLocation(personId, bizB)).ok).toBe(false);
    // ...and our person never leaks into the other org's people list.
    const theirPeople = await orgRepoX.listPeople();
    expect(theirPeople.some((p) => p.id === personId)).toBe(false);
  });
});
