import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { resolveOrdinaryEarningsRate } from "@/lib/xero/resolve";

/**
 * Integration coverage of the staff↔Xero-employee mapping (#15) against the
 * real DB: upsert (create + replace), list, get, delete, tenant isolation, and
 * a small end-to-end where the resolved ordinary earnings rate is persisted.
 */

describe("xero staff↔employee mapping", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA1 = "";
  let staffA2 = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Xero Map Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Xero Map Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    staffA1 = (await repoA.addStaff({ name: "Ava", email: "ava@a.test" })).id;
    staffA2 = (await repoA.addStaff({ name: "Ben", email: "ben@a.test" })).id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("upserts (create then replace), gets, and lists mappings", async () => {
    const created = await repoA.upsertXeroEmployeeMap({
      staffMemberId: staffA1,
      xeroEmployeeId: "emp-1",
      xeroEmployeeName: "Ava Employee",
      earningsRateId: "rate-1",
      payrollCalendarId: "cal-1",
    });
    expect(created.xeroEmployeeId).toBe("emp-1");
    expect(created.earningsRateId).toBe("rate-1");

    // Re-upsert the SAME staff member replaces in place (one per staff).
    const replaced = await repoA.upsertXeroEmployeeMap({
      staffMemberId: staffA1,
      xeroEmployeeId: "emp-1b",
      xeroEmployeeName: "Ava Renamed",
      earningsRateId: "rate-2",
      payrollCalendarId: "cal-2",
    });
    expect(replaced.id).toBe(created.id); // same row
    expect(replaced.xeroEmployeeId).toBe("emp-1b");
    expect(replaced.earningsRateId).toBe("rate-2");

    const got = await repoA.getXeroEmployeeMapForStaff(staffA1);
    expect(got!.payrollCalendarId).toBe("cal-2");

    await repoA.upsertXeroEmployeeMap({
      staffMemberId: staffA2,
      xeroEmployeeId: "emp-2",
      xeroEmployeeName: "Ben Employee",
      earningsRateId: null, // unresolved rate → blocked from push
      payrollCalendarId: "cal-1",
    });
    const all = await repoA.listXeroEmployeeMaps();
    expect(all).toHaveLength(2);
    const ben = all.find((m) => m.staffMemberId === staffA2)!;
    expect(ben.earningsRateId).toBeNull();
  });

  it("delete removes a mapping (business-scoped)", async () => {
    await repoA.deleteXeroEmployeeMap(staffA2);
    expect(await repoA.getXeroEmployeeMapForStaff(staffA2)).toBeNull();
    expect(await repoA.listXeroEmployeeMaps()).toHaveLength(1);
  });

  it("mappings are isolated per business", async () => {
    // Business B sees none of A's mappings, and can't get A's staff mapping.
    expect(await repoB.listXeroEmployeeMaps()).toHaveLength(0);
    expect(await repoB.getXeroEmployeeMapForStaff(staffA1)).toBeNull();
  });

  it("end-to-end: resolve the ordinary rate from fake reads, then persist it", async () => {
    // Simulate what the mapping action does with the client's read results.
    const orgEarningsRates = [
      {
        earningsRateId: "ord",
        name: "Ordinary Hours",
        earningsType: "RegularEarnings",
      },
      {
        earningsRateId: "ot",
        name: "Overtime",
        earningsType: "OvertimeEarnings",
      },
    ];
    const payTemplateEarnings = [{ earningsRateId: "ord" }];
    const resolved = resolveOrdinaryEarningsRate({
      payTemplateEarnings,
      orgEarningsRates,
    });
    expect(resolved.earningsRateId).toBe("ord");

    const map = await repoA.upsertXeroEmployeeMap({
      staffMemberId: staffA1,
      xeroEmployeeId: "emp-1",
      xeroEmployeeName: "Ava Employee",
      earningsRateId: resolved.earningsRateId,
      payrollCalendarId: "cal-weekly",
    });
    expect(map.earningsRateId).toBe("ord");
    expect(map.payrollCalendarId).toBe("cal-weekly");
  });
});
