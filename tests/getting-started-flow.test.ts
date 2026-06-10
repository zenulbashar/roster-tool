import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * Integration coverage for the getting-started checklist's data layer: the
 * tenant-scoped existence flags (`getSetupFlags`) the dashboard derives the
 * checklist from. Requires a local Postgres (see CI / README). Business A is
 * fully set up EXCEPT clock-in; business B has ONLY a clock-in link — so
 * every flag is asserted true for one tenant and false for the other,
 * proving none leaks across businesses.
 */
describe("getting started flow", () => {
  let businessA = "";
  let businessB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Setup Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Setup Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;

    const repoA = createTenantRepo(businessA);
    await repoA.addStaff({ name: "Ava", email: "ava@setup-a.test" });
    await repoA.addTemplate({
      label: "Morning",
      startTime: "08:00",
      endTime: "14:00",
      weekdays: [1, 2, 3],
    });
    await repoA.createPeriod({
      label: "Week 1",
      startDate: "2026-06-15",
      endDate: "2026-06-21",
    });
    await repoA.addSupplier({
      name: "Beans Co",
      deliveryDays: [2],
      orderCutoffDaysBefore: 1,
    });
    await repoA.addItem({ name: "Coffee beans" });

    // B's ONLY progress: a personal-phone clock-in link.
    await createTenantRepo(businessB).updateBusinessSettings({
      personalClockTokenHash: randomBytes(16).toString("hex"),
    });
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
  });

  it("reports A's data without leaking B's clock-in link", async () => {
    expect(await createTenantRepo(businessA).getSetupFlags()).toEqual({
      hasStaff: true,
      hasShiftTemplate: true,
      hasRosterPeriod: true,
      hasClockInLink: false,
      hasSupplier: true,
      hasItem: true,
    });
  });

  it("reports B's clock-in link without leaking A's data", async () => {
    expect(await createTenantRepo(businessB).getSetupFlags()).toEqual({
      hasStaff: false,
      hasShiftTemplate: false,
      hasRosterPeriod: false,
      hasClockInLink: true,
      hasSupplier: false,
      hasItem: false,
    });
  });

  it("counts the kiosk link as clock-in set up too", async () => {
    const repoA = createTenantRepo(businessA);
    await repoA.updateBusinessSettings({
      kioskTokenHash: randomBytes(16).toString("hex"),
    });
    expect((await repoA.getSetupFlags()).hasClockInLink).toBe(true);
  });
});
