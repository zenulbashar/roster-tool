import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { buildApprovedHoursCsv } from "@/lib/timesheet-export";

/**
 * Integration coverage for per-employee pay rates and the approved-hours export
 * query: rates are stored/scoped per business, and the export returns only
 * approved entries in range, scoped to the business.
 */
describe("pay rates + approved-hours export query", () => {
  let businessA = "";
  let businessB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Rates Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Rates Biz B" })
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

  it("stores a staff member's rate type, amount and label", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Ivy", email: "ivy@a.test" });
    const updated = await repo.updateStaff(staff.id, {
      payRateCents: 2850,
      rateType: "award",
      rateLabel: "Level 2 cook",
    });
    expect(updated?.payRateCents).toBe(2850);
    expect(updated?.rateType).toBe("award");
    expect(updated?.rateLabel).toBe("Level 2 cook");
  });

  it("cannot set a rate on another tenant's staff", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const staffA = await repoA.addStaff({ name: "Jo", email: "jo@a.test" });
    expect(
      await repoB.updateStaff(staffA.id, { payRateCents: 9999 }),
    ).toBeNull();
  });

  it("exports only approved, in-range entries scoped to the business", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const start = new Date("2026-06-08T00:00:00Z");
    const end = new Date("2026-06-15T00:00:00Z");

    const staffA = await repoA.addStaff({ name: "Kai", email: "kai@a.test" });

    // Approved, in range -> included.
    const e1 = await repoA.clockIn(staffA.id, {
      at: new Date("2026-06-09T09:00:00Z"),
    });
    await repoA.clockOut(e1.id, new Date("2026-06-09T17:00:00Z"));
    await repoA.setEntryApproved(e1.id, true);

    // In range but NOT approved -> excluded.
    const e2 = await repoA.clockIn(staffA.id, {
      at: new Date("2026-06-10T09:00:00Z"),
    });
    await repoA.clockOut(e2.id, new Date("2026-06-10T12:00:00Z"));

    // Approved but out of range -> excluded.
    const e3 = await repoA.clockIn(staffA.id, {
      at: new Date("2026-06-01T09:00:00Z"),
    });
    await repoA.clockOut(e3.id, new Date("2026-06-01T12:00:00Z"));
    await repoA.setEntryApproved(e3.id, true);

    // Another tenant's approved entry -> excluded.
    const staffB = await repoB.addStaff({ name: "Lee", email: "lee@b.test" });
    const eB = await repoB.clockIn(staffB.id, {
      at: new Date("2026-06-09T09:00:00Z"),
    });
    await repoB.clockOut(eB.id, new Date("2026-06-09T17:00:00Z"));
    await repoB.setEntryApproved(eB.id, true);

    const rows = await repoA.listApprovedEntriesForExport(start, end);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.staffName).toBe("Kai");
    expect(rows[0]!.staffEmail).toBe("kai@a.test");
    expect(rows[0]!.clockInAt.toISOString()).toBe("2026-06-09T09:00:00.000Z");

    // B's export never sees A's data.
    expect(await repoB.listApprovedEntriesForExport(start, end)).toHaveLength(
      1,
    );

    // End-to-end: feed the query straight into the CSV builder.
    const csv = buildApprovedHoursCsv(rows, {
      timezone: "Australia/Sydney",
      businessName: "Rates Biz A",
    });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("NOT a payroll calculation");
    // Title + disclaimer + blank + header + exactly one data row.
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain("Kai,kai@a.test");
  });
});
