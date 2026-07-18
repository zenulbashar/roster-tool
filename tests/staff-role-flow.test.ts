import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * M38: the optional staff position label (role). It persists on add + edit,
 * comes back on reads, and is purely informational — it never gates anything.
 */
describe("M38 staff role", () => {
  let business = "";

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Role Cafe" })
      .returning();
    business = b!.id;
  });

  afterAll(async () => {
    if (business)
      await db.delete(businesses).where(eq(businesses.id, business));
    await db.$client.end();
  });

  it("stores a role on add and returns it on read", async () => {
    const repo = createTenantRepo(business);
    const staff = await repo.addStaff({
      name: "Ravi",
      email: "ravi@role.test",
      role: "Barista",
    });
    expect(staff.role).toBe("Barista");
    const fetched = await repo.getStaff(staff.id);
    expect(fetched?.role).toBe("Barista");
  });

  it("defaults role to null when omitted", async () => {
    const repo = createTenantRepo(business);
    const staff = await repo.addStaff({ name: "Noa", email: "noa@role.test" });
    expect(staff.role).toBeNull();
  });

  it("updates and clears the role", async () => {
    const repo = createTenantRepo(business);
    const staff = await repo.addStaff({
      name: "Mira",
      email: "mira@role.test",
      role: "Floor",
    });
    const updated = await repo.updateStaff(staff.id, { role: "Manager" });
    expect(updated?.role).toBe("Manager");
    const cleared = await repo.updateStaff(staff.id, { role: null });
    expect(cleared?.role).toBeNull();
  });

  it("carries the role through listStaff", async () => {
    const repo = createTenantRepo(business);
    await repo.addStaff({
      name: "Deb",
      email: "deb@role.test",
      role: "Chef",
    });
    const list = await repo.listStaff();
    const deb = list.find((s) => s.email === "deb@role.test");
    expect(deb?.role).toBe("Chef");
  });
});
