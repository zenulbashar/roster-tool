import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organisations,
  businesses,
  staffMembers,
  rosterPeriods,
  xeroConnections,
  googleDriveConnections,
  users,
  platformAdmins,
  adminActivities,
} from "@/lib/db/schema";
import { createAdminRepo, isPlatformAdmin } from "@/lib/admin/repository";

/**
 * M37: the Zale IT admin console's cross-tenant read layer + audit log. Verifies
 * client aggregation (sites/staff/integrations/last-active), status filtering,
 * KPI stats, one-client detail, and the append-only activity log — plus the
 * platform_admin membership check requireOwner uses to re-verify an impersonator.
 */
describe("M37 admin repository (cross-tenant reads + audit log)", () => {
  const repo = createAdminRepo();
  let orgActive = "";
  let orgTrial = "";
  let bizA1 = "";
  let bizA2 = "";
  let bizT1 = "";
  let adminUserId = "";
  let ownerUserId = "";

  beforeAll(async () => {
    // Defensive: this admin email is fixed, so clear any leftover row from a
    // prior interrupted run before provisioning it (the DB is shared in dev).
    await db
      .delete(users)
      .where(sql`lower(${users.email}) = 'priya@zaleit.test'`);

    const [oa] = await db
      .insert(organisations)
      .values({ name: "Troy's Kebabs", planStatus: "active" })
      .returning();
    orgActive = oa!.id;
    const [ot] = await db
      .insert(organisations)
      .values({ name: "Zeta Trial Cafe", planStatus: "trial" })
      .returning();
    orgTrial = ot!.id;

    const [a1] = await db
      .insert(businesses)
      .values({ name: "Troy's — Main", orgId: orgActive })
      .returning();
    const [a2] = await db
      .insert(businesses)
      .values({ name: "Troy's — Airport", orgId: orgActive })
      .returning();
    const [t1] = await db
      .insert(businesses)
      .values({ name: "Zeta Cafe", orgId: orgTrial })
      .returning();
    bizA1 = a1!.id;
    bizA2 = a2!.id;
    bizT1 = t1!.id;

    // Two active + one inactive staff on the active org; one on the trial org.
    await db.insert(staffMembers).values([
      { orgId: orgActive, businessId: bizA1, name: "Sarah", email: "s@x.test" },
      { orgId: orgActive, businessId: bizA1, name: "Jake", email: "j@x.test" },
      {
        orgId: orgActive,
        businessId: bizA1,
        name: "Gone",
        email: "g@x.test",
        active: false,
      },
      { orgId: orgTrial, businessId: bizT1, name: "Zed", email: "z@x.test" },
    ]);

    // Integrations: active org has an active Xero (on A2) + a Drive (on A1).
    await db.insert(xeroConnections).values({
      businessId: bizA2,
      xeroTenantId: "xt-1",
      orgName: "Troy's Kebabs Pty Ltd",
      connectedAccountEmail: "owner@troy.test",
      accessTokenEnc: "enc",
      refreshTokenEnc: "enc",
      tokenExpiry: new Date(),
      status: "active",
    });
    await db.insert(googleDriveConnections).values({
      businessId: bizA1,
      googleAccountEmail: "owner@troy.test",
      accessTokenEnc: "enc",
      refreshTokenEnc: "enc",
      tokenExpiry: new Date(),
    });

    // A roster period gives the active org a last-active signal.
    await db.insert(rosterPeriods).values({
      businessId: bizA1,
      label: "Week 1",
      startDate: "2026-07-13",
      endDate: "2026-07-19",
    });

    const [au] = await db
      .insert(users)
      .values({ email: "priya@zaleit.test", name: "Priya" })
      .returning();
    adminUserId = au!.id;
    await db
      .insert(platformAdmins)
      .values({ userId: adminUserId, name: "Priya" });
    const [ou] = await db
      .insert(users)
      .values({ email: "owner@troy.test", name: "Owner" })
      .returning();
    ownerUserId = ou!.id;
  });

  afterAll(async () => {
    await db
      .delete(adminActivities)
      .where(inArray(adminActivities.orgId, [orgActive, orgTrial]));
    for (const id of [orgActive, orgTrial]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    for (const id of [adminUserId, ownerUserId]) {
      if (id) await db.delete(users).where(eq(users.id, id));
    }
    await db.$client.end();
  });

  it("aggregates clients with sites, active-staff, integrations and last-active", async () => {
    const clients = await repo.listClients();
    const troy = clients.find((c) => c.orgId === orgActive)!;
    expect(troy).toBeTruthy();
    expect(troy.siteCount).toBe(2);
    expect(troy.staffCount).toBe(2); // inactive excluded
    expect(troy.hasXero).toBe(true);
    expect(troy.hasDrive).toBe(true);
    expect(troy.planStatus).toBe("active");
    expect(troy.lastActiveAt).toBeInstanceOf(Date);

    const zeta = clients.find((c) => c.orgId === orgTrial)!;
    expect(zeta.siteCount).toBe(1);
    expect(zeta.staffCount).toBe(1);
    expect(zeta.hasXero).toBe(false);
    expect(zeta.hasDrive).toBe(false);
    expect(zeta.lastActiveAt).toBeNull();
  });

  it("filters by status and searches by name", async () => {
    const trials = await repo.listClients({ status: "trial" });
    expect(trials.some((c) => c.orgId === orgTrial)).toBe(true);
    expect(trials.some((c) => c.orgId === orgActive)).toBe(false);

    const found = await repo.listClients({ search: "kebab" });
    expect(found.some((c) => c.orgId === orgActive)).toBe(true);
    expect(found.some((c) => c.orgId === orgTrial)).toBe(false);
  });

  it("reports KPI stats over all orgs", async () => {
    const stats = await repo.getClientStats();
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(stats.trial).toBeGreaterThanOrEqual(1);
    expect(stats.totalStaff).toBeGreaterThanOrEqual(3);
  });

  it("returns one client's detail with per-location integrations", async () => {
    const detail = await repo.getClient(orgActive);
    expect(detail).toBeTruthy();
    expect(detail!.name).toBe("Troy's Kebabs");
    expect(detail!.staffCount).toBe(2);
    expect(detail!.locations).toHaveLength(2);
    const airport = detail!.locations.find((l) => l.id === bizA2)!;
    expect(airport.hasXero).toBe(true);
    expect(airport.xeroActive).toBe(true);
    const main = detail!.locations.find((l) => l.id === bizA1)!;
    expect(main.hasDrive).toBe(true);
    expect(main.driveEmail).toBe("owner@troy.test");

    expect(
      await repo.getClient("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("records and lists activity, filtered per client", async () => {
    await repo.recordActivity({
      adminUserId,
      adminName: "Priya",
      action: "Entered live account",
      orgId: orgActive,
      businessId: bizA1,
      venueName: "Troy's Kebabs",
    });
    await repo.recordActivity({
      adminUserId,
      adminName: "Priya",
      action: "Publish roster",
      detail: "Notifies 6 staff",
      isWrite: true,
      orgId: orgActive,
      businessId: bizA1,
      venueName: "Troy's Kebabs",
    });
    await repo.recordActivity({
      adminUserId,
      adminName: "Priya",
      action: "Entered live account",
      orgId: orgTrial,
      businessId: bizT1,
      venueName: "Zeta Trial Cafe",
    });

    const all = await repo.listActivity({ limit: 50 });
    expect(all.length).toBeGreaterThanOrEqual(3);
    // Newest first.
    expect(all[0]!.orgId).toBe(orgTrial);

    const troyOnly = await repo.listActivity({ orgId: orgActive });
    expect(troyOnly).toHaveLength(2);
    expect(troyOnly.some((a) => a.isWrite)).toBe(true);
    expect(await repo.countActivity(orgActive)).toBe(2);
  });

  it("isPlatformAdmin distinguishes admins from owners", async () => {
    expect(await isPlatformAdmin(adminUserId)).toBe(true);
    expect(await isPlatformAdmin(ownerUserId)).toBe(false);
  });
});
