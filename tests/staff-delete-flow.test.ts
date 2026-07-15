import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * Integration coverage for owner-side staff editing + deletion: details can be
 * updated, a delete is tenant-scoped and cascades the person's history away,
 * and the timesheet-count guard is accurate and scoped.
 */
describe("staff edit + delete", () => {
  let businessA = "";
  let businessB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Delete Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Delete Biz B" })
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

  it("edits a staff member's name and email", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Mara", email: "mara@a.test" });
    const updated = await repo.updateStaff(staff.id, {
      name: "Mara Lopez",
      email: "mara.lopez@a.test",
    });
    expect(updated?.name).toBe("Mara Lopez");
    expect(updated?.email).toBe("mara.lopez@a.test");
  });

  it("counts a staff member's timesheet history and deletes it (cascade)", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Ned", email: "ned@a.test" });

    // No history yet.
    expect(await repo.countTimesheetEntriesForStaff(staff.id)).toBe(0);

    const e1 = await repo.clockIn(staff.id, {
      at: new Date("2026-06-09T09:00:00Z"),
    });
    await repo.clockOut(e1.id, new Date("2026-06-09T17:00:00Z"));
    expect(await repo.countTimesheetEntriesForStaff(staff.id)).toBe(1);

    const deleted = await repo.deleteStaff(staff.id);
    expect(deleted?.id).toBe(staff.id);

    // Gone, and their timesheet cascaded away with them.
    expect(await repo.getStaff(staff.id)).toBeNull();
    expect(await repo.countTimesheetEntriesForStaff(staff.id)).toBe(0);
  });

  it("cannot delete (or count) another tenant's staff", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const staffA = await repoA.addStaff({ name: "Ola", email: "ola@a.test" });
    const e = await repoA.clockIn(staffA.id, {
      at: new Date("2026-06-10T09:00:00Z"),
    });
    await repoA.clockOut(e.id, new Date("2026-06-10T12:00:00Z"));

    // B sees none of A's history and can't remove A's person.
    expect(await repoB.countTimesheetEntriesForStaff(staffA.id)).toBe(0);
    expect(await repoB.deleteStaff(staffA.id)).toBeNull();

    // A's staff member is untouched.
    expect((await repoA.getStaff(staffA.id))?.id).toBe(staffA.id);
    expect(await repoA.countTimesheetEntriesForStaff(staffA.id)).toBe(1);
  });
});
