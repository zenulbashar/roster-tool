import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  businesses,
  users,
  staffMembers,
  organisations,
  orgMemberships,
  staffLocations,
} from "@/lib/db/schema";
import { backfillOrgs } from "@/lib/tenant/org-backfill";

/**
 * M29 Phase 0 backfill (Strategy A — staff collapse to the org). Simulates
 * legacy pre-migration rows (business + owner + staff with no org), runs the
 * idempotent `backfillOrgs`, and asserts: one org per business (id reused), each
 * staff pointed at its home org, an owner membership per onboarded owner, a
 * 1:1 `staff_location` per staff (carrying its active flag), all correctly
 * scoped — and that a second run changes nothing (idempotent).
 *
 * retry: `backfillOrgs` sweeps EVERY business in the shared test DB, so its
 * INSERT…SELECT statements can hit an FK violation when a concurrently
 * running test file tears its rows down between the snapshot read and the
 * insert — a test-parallelism artifact, not a product bug (the canonical
 * copy runs once inside a migration). Assertions stay strict; a
 * deterministic regression still fails all three attempts.
 */
describe("M29 org backfill (Phase 0)", { retry: 2 }, () => {
  let bizA = "";
  let bizB = "";
  let userA = "";
  let userB = "";
  let staffA1 = "";
  let staffA2 = "";
  let staffB1 = "";

  beforeAll(async () => {
    // Two independent legacy businesses, org_id left NULL (pre-migration shape).
    const [a] = await db
      .insert(businesses)
      .values({ name: "Backfill Cafe A", timezone: "Australia/Perth" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Backfill Cafe B" })
      .returning();
    bizA = a!.id;
    bizB = b!.id;

    // One onboarded owner per business (user.businessId set, no org yet).
    const [ua] = await db
      .insert(users)
      .values({ email: `owner-a-${bizA}@example.test`, businessId: bizA })
      .returning();
    const [ub] = await db
      .insert(users)
      .values({ email: `owner-b-${bizB}@example.test`, businessId: bizB })
      .returning();
    userA = ua!.id;
    userB = ub!.id;

    // Staff at each business; A2 is inactive to prove `active` is carried over.
    const [s1] = await db
      .insert(staffMembers)
      .values({ businessId: bizA, name: "Ada", email: "ada@a.test" })
      .returning();
    const [s2] = await db
      .insert(staffMembers)
      .values({
        businessId: bizA,
        name: "Ben",
        email: "ben@a.test",
        active: false,
      })
      .returning();
    const [s3] = await db
      .insert(staffMembers)
      .values({ businessId: bizB, name: "Cara", email: "cara@b.test" })
      .returning();
    staffA1 = s1!.id;
    staffA2 = s2!.id;
    staffB1 = s3!.id;
  });

  afterAll(async () => {
    // Deleting the businesses cascades staff_member + staff_location; deleting
    // the organisations cascades org_membership. Users are cleaned explicitly.
    for (const id of [bizA, bizB]) {
      if (id) await db.delete(businesses).where(eq(businesses.id, id));
    }
    for (const id of [bizA, bizB]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    for (const id of [userA, userB]) {
      if (id) await db.delete(users).where(eq(users.id, id));
    }
    await db.$client.end();
  });

  it("creates one org per business (id reused) and points rows at it", async () => {
    await backfillOrgs(db);

    // An organisation with id === business id, carrying its name + timezone.
    const [orgA] = await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, bizA));
    expect(orgA?.name).toBe("Backfill Cafe A");
    expect(orgA?.defaultTimezone).toBe("Australia/Perth");

    // Each business now points at its own-id organisation.
    const [rowA] = await db
      .select({ orgId: businesses.orgId })
      .from(businesses)
      .where(eq(businesses.id, bizA));
    const [rowB] = await db
      .select({ orgId: businesses.orgId })
      .from(businesses)
      .where(eq(businesses.id, bizB));
    expect(rowA?.orgId).toBe(bizA);
    expect(rowB?.orgId).toBe(bizB);

    // Staff point at their HOME business's org — never the other business's.
    const staff = await db
      .select({ id: staffMembers.id, orgId: staffMembers.orgId })
      .from(staffMembers)
      .where(inArray(staffMembers.id, [staffA1, staffA2, staffB1]));
    const byId = Object.fromEntries(staff.map((s) => [s.id, s.orgId]));
    expect(byId[staffA1]).toBe(bizA);
    expect(byId[staffA2]).toBe(bizA);
    expect(byId[staffB1]).toBe(bizB);
  });

  it("makes each onboarded owner a member of their own org only", async () => {
    const memA = await db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, userA));
    expect(memA).toHaveLength(1);
    expect(memA[0]!.orgId).toBe(bizA);
    expect(memA[0]!.role).toBe("owner");

    const memB = await db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, userB));
    expect(memB).toHaveLength(1);
    expect(memB[0]!.orgId).toBe(bizB);
    // Isolation: owner A's membership never points at business B's org.
    expect(memA[0]!.orgId).not.toBe(bizB);
  });

  it("creates a 1:1 staff_location per staff, carrying active + scope", async () => {
    const locs = await db
      .select()
      .from(staffLocations)
      .where(
        inArray(staffLocations.staffMemberId, [staffA1, staffA2, staffB1]),
      );
    expect(locs).toHaveLength(3);

    const loc1 = locs.find((l) => l.staffMemberId === staffA1)!;
    expect(loc1.businessId).toBe(bizA);
    expect(loc1.orgId).toBe(bizA);
    expect(loc1.active).toBe(true);

    // The inactive staff member's membership carries active=false.
    const loc2 = locs.find((l) => l.staffMemberId === staffA2)!;
    expect(loc2.active).toBe(false);

    // Business B's staff sits under business B's org/location, never A's.
    const loc3 = locs.find((l) => l.staffMemberId === staffB1)!;
    expect(loc3.businessId).toBe(bizB);
    expect(loc3.orgId).toBe(bizB);
  });

  it("is idempotent — a second run creates no duplicates", async () => {
    const count = async () => {
      const orgs = await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(inArray(organisations.id, [bizA, bizB]));
      const mems = await db
        .select({ id: orgMemberships.id })
        .from(orgMemberships)
        .where(inArray(orgMemberships.userId, [userA, userB]));
      const locs = await db
        .select({ id: staffLocations.id })
        .from(staffLocations)
        .where(
          inArray(staffLocations.staffMemberId, [staffA1, staffA2, staffB1]),
        );
      return {
        orgs: orgs.length,
        mems: mems.length,
        locs: locs.length,
      };
    };

    const before = await count();
    await backfillOrgs(db);
    await backfillOrgs(db);
    const after = await count();

    expect(after).toEqual(before);
    expect(after).toEqual({ orgs: 2, mems: 2, locs: 3 });
  });
});
