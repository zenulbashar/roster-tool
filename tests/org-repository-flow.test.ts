import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organisations,
  orgMemberships,
  businesses,
  users,
} from "@/lib/db/schema";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { resolveOrgForUser } from "@/lib/tenant/org-access";

/**
 * M29 Phase 1: organisation-scoped access. Verifies the org repo forces `org_id`
 * on writes, lists only its own locations, and — the N2 guard — refuses to
 * confirm another org's business (`locationBelongsToOrg`). Also checks that an
 * owner's org resolves from their membership.
 */
describe("M29 org repository + membership (Phase 1)", () => {
  let orgA = "";
  let orgB = "";
  let bizA = "";
  let bizB = "";
  let ownerA = "";

  beforeAll(async () => {
    const [oa] = await db
      .insert(organisations)
      .values({ name: "Org A" })
      .returning();
    const [ob] = await db
      .insert(organisations)
      .values({ name: "Org B" })
      .returning();
    orgA = oa!.id;
    orgB = ob!.id;

    const [ba] = await db
      .insert(businesses)
      .values({ name: "A Home", orgId: orgA })
      .returning();
    const [bb] = await db
      .insert(businesses)
      .values({ name: "B Home", orgId: orgB })
      .returning();
    bizA = ba!.id;
    bizB = bb!.id;

    const [ua] = await db
      .insert(users)
      .values({ email: `owner-${orgA}@example.test`, businessId: bizA })
      .returning();
    ownerA = ua!.id;
    await db
      .insert(orgMemberships)
      .values({ orgId: orgA, userId: ownerA, role: "owner" });
  });

  afterAll(async () => {
    for (const id of [orgA, orgB]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    if (ownerA) await db.delete(users).where(eq(users.id, ownerA));
    await db.$client.end();
  });

  it("resolves an owner's org from their membership", async () => {
    expect(await resolveOrgForUser(ownerA)).toBe(orgA);
    // A user with no membership resolves to null.
    expect(
      await resolveOrgForUser("00000000-0000-0000-0000-000000000000"),
    ).toBe(null);
  });

  it("creates locations under the org and lists only its own", async () => {
    const org = createOrgRepo(orgA);
    const created = await org.createLocation({
      name: "A Airport",
      timezone: "Australia/Perth",
    });
    expect(created.name).toBe("A Airport");

    const locations = await org.listLocations();
    const ids = locations.map((l) => l.id);
    expect(ids).toContain(bizA);
    expect(ids).toContain(created.id);
    // Never leaks another org's location.
    expect(ids).not.toContain(bizB);
    expect(await org.countLocations()).toBe(locations.length);
  });

  it("confirms own locations and refuses another org's (N2)", async () => {
    const orgRepoA = createOrgRepo(orgA);
    expect(await orgRepoA.locationBelongsToOrg(bizA)).toBe(true);
    // Cross-org: org A must never accept org B's business id.
    expect(await orgRepoA.locationBelongsToOrg(bizB)).toBe(false);
    // Unknown id is refused too.
    expect(
      await orgRepoA.locationBelongsToOrg(
        "00000000-0000-0000-0000-000000000000",
      ),
    ).toBe(false);
  });
});
