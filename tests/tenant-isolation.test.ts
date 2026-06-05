import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * Proves the data-access layer isolates tenants: a repo scoped to one business
 * can neither read nor write another business's rows, and writes are forced to
 * the repo's own business id.
 */
describe("tenant isolation", () => {
  let businessA = "";
  let businessB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Test Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Test Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("forces inserts to the repo's business id", async () => {
    const repoA = createTenantRepo(businessA);
    const staff = await repoA.addStaff({
      name: "Alice",
      email: "alice@a.test",
    });
    expect(staff.businessId).toBe(businessA);
  });

  it("does not leak rows across tenants on list", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    await repoB.addStaff({ name: "Bob", email: "bob@b.test" });

    const aStaff = await repoA.listStaff();
    const bStaff = await repoB.listStaff();

    expect(aStaff.every((s) => s.businessId === businessA)).toBe(true);
    expect(bStaff.every((s) => s.businessId === businessB)).toBe(true);
    expect(aStaff.some((s) => s.email === "bob@b.test")).toBe(false);
  });

  it("blocks cross-tenant reads by id", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const bobInB = await repoB.addStaff({
      name: "Bob2",
      email: "bob2@b.test",
    });

    // A cannot fetch B's staff member even with the correct id.
    expect(await repoA.getStaff(bobInB.id)).toBeNull();
    // B can.
    expect((await repoB.getStaff(bobInB.id))?.id).toBe(bobInB.id);
  });

  it("blocks cross-tenant writes by id", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const target = await repoB.addStaff({
      name: "Carol",
      email: "carol@b.test",
    });

    const result = await repoA.updateStaff(target.id, { name: "Hacked" });
    expect(result).toBeNull();

    // The row is untouched.
    const fresh = await repoB.getStaff(target.id);
    expect(fresh?.name).toBe("Carol");
  });
});
