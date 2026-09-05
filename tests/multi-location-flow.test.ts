import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, organisations, staffNotifications } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import {
  remindCertificationsForBusiness,
  remindOrdersForBusiness,
  ownerEmailsForBusiness,
} from "@/lib/jobs/handlers";
import type { OutgoingEmail } from "@/lib/email";
import { makeOrgWithTwoLocations, type TwoLocationOrg } from "./helpers/org";

/**
 * COR-01 / COR-02 / COR-11 regression guards — the multi-location cases the
 * suite never had (TEST-02). Every fixture here is built through
 * `makeOrgWithTwoLocations`, i.e. the way the app builds tenants: the owner is
 * reachable ONLY via org_membership for the second location, exactly as in
 * production.
 *
 * The job cases drive the PER-BUSINESS body of each sweep directly (the unit
 * the global sweep loops over), so they cannot race other test files' sweeps
 * over the shared database; dates are still kept in 2020 so other files'
 * sweeps never touch these fixtures either.
 */
function at(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

describe("multi-location: jobs, notices and setup flags", () => {
  let t: TwoLocationOrg;
  let foreignOrg = "";
  let foreignBiz = "";

  beforeAll(async () => {
    t = await makeOrgWithTwoLocations({ prefix: "ml" });
    const [o] = await db
      .insert(organisations)
      .values({ name: "ml Foreign Org" })
      .returning();
    foreignOrg = o!.id;
    const [fb] = await db
      .insert(businesses)
      .values({ name: "ml Foreign Cafe", orgId: foreignOrg })
      .returning();
    foreignBiz = fb!.id;
  });

  afterAll(async () => {
    await t.cleanup();
    await db.delete(organisations).where(eq(organisations.id, foreignOrg));
  });

  /* ----- COR-01: owner resolution reaches every location of the org ----- */

  it("resolves the owner for a location added AFTER onboarding (via org membership)", async () => {
    expect(await ownerEmailsForBusiness(t.bizA)).toEqual([t.ownerEmail]);
    // The legacy users.business_id pointer does NOT point here — this is the
    // location the old lookup silently skipped.
    expect(await ownerEmailsForBusiness(t.bizB)).toEqual([t.ownerEmail]);
  });

  it("never resolves another org's owner for a foreign location", async () => {
    expect(await ownerEmailsForBusiness(foreignBiz)).toEqual([]);
  });

  it("emails certification reminders for the SECOND location", async () => {
    const repoB = createTenantRepo(t.bizB);
    const bob = await repoB.addStaff({ name: "Bob B", email: "bob@ml-b.test" });
    // Expires in 10 days at the sweep date → "early" stage (lead 30) is due.
    await repoB.addCertification({
      staffMemberId: bob.id,
      certType: "rsa",
      expiryDate: "2020-01-15",
    });

    const sent: OutgoingEmail[] = [];
    const n = await remindCertificationsForBusiness(
      { id: t.bizB, name: "ml Loc B", timezone: "UTC", leadDays: 30 },
      at("2020-01-05"),
      {
        send: async (m) => {
          sent.push(m);
        },
      },
    );

    expect(n).toBe(1);
    const mine = sent.filter((m) => m.to === t.ownerEmail);
    expect(mine.length).toBe(1);
    expect(mine[0]!.subject).toContain("ml Loc B");
    expect(mine[0]!.text).toContain("Bob B");
  });

  it("emails order reminders for the SECOND location", async () => {
    const repoB = createTenantRepo(t.bizB);
    // Mon delivery (2020-01-06) with a 2-day cutoff → order-by Sat 2020-01-04.
    const sup = await repoB.addSupplier({
      name: "ml Beans",
      deliveryDays: [1],
      orderCutoffDaysBefore: 2,
    });
    const item = await repoB.addItem({ name: "ml Coffee", supplierId: sup.id });
    await repoB.recordStockCheck([{ itemId: item.id, status: "needs_order" }], {
      checkedByStaffId: null,
      checkedAt: at("2020-01-03"),
    });

    const sent: OutgoingEmail[] = [];
    const n = await remindOrdersForBusiness(
      { id: t.bizB, name: "ml Loc B", timezone: "UTC" },
      at("2020-01-04"),
      {
        send: async (m) => {
          sent.push(m);
        },
      },
    );

    expect(n).toBe(1);
    const mine = sent.filter((m) => m.to === t.ownerEmail);
    expect(mine.length).toBe(1);
    expect(mine[0]!.subject).toContain("ml Loc B");
    expect(mine[0]!.text).toContain("ml Beans");
  });

  /* ----- COR-02: notices follow the person across the org's locations ----- */

  it("shows a notice created at another location on the person's home /me", async () => {
    const repoA = createTenantRepo(t.bizA);
    const repoB = createTenantRepo(t.bizB);
    const ada = await repoA.addStaff({ name: "Ada", email: "ada@ml-a.test" });
    // Lent to location B (cross-location cover / loan).
    const org = createOrgRepo(t.orgId);
    expect(await org.addPersonToLocation(ada.id, t.bizB)).toEqual({ ok: true });

    // A notice raised AT B — e.g. "you're rostered at Loc B" or the daily
    // reminder for a shift there.
    const atB = await repoB.createStaffNotification({
      staffMemberId: ada.id,
      type: "rostered",
      title: "You're on the roster at Loc B",
    });
    expect(atB).not.toBeNull();

    // /me is scoped to the person's HOME location (A). It must still see it.
    const seen = await repoA.listStaffNotifications(ada.id);
    expect(seen.map((n) => n.id)).toContain(atB!.id);
    expect(await repoA.countUnreadStaffNotifications(ada.id)).toBe(1);

    // And mark-read through the home repo works on the cross-location notice.
    expect(
      await repoA.markStaffNotificationRead(atB!.id, ada.id),
    ).not.toBeNull();
    expect(await repoA.countUnreadStaffNotifications(ada.id)).toBe(0);
  });

  it("never shows a notice from a business outside the person's org", async () => {
    const repoA = createTenantRepo(t.bizA);
    const eve = await repoA.addStaff({ name: "Eve", email: "eve@ml-a.test" });
    // The repo REFUSES to create a notice for a non-member (TEST-03)...
    expect(
      await createTenantRepo(foreignBiz).createStaffNotification({
        staffMemberId: eve.id,
        type: "rostered",
        title: "Should never be visible",
      }),
    ).toBeNull();
    // ...so simulate a stray row written around it, keyed to this person.
    const [stray] = await db
      .insert(staffNotifications)
      .values({
        businessId: foreignBiz,
        staffMemberId: eve.id,
        type: "rostered",
        title: "Should never be visible",
      })
      .returning();
    expect(stray).toBeDefined();

    const seen = await repoA.listStaffNotifications(eve.id);
    expect(seen.map((n) => n.id)).not.toContain(stray!.id);
    expect(await repoA.markStaffNotificationRead(stray!.id, eve.id)).toBeNull();
  });

  it("never shows another person's notice from the same org", async () => {
    const repoA = createTenantRepo(t.bizA);
    const kim = await repoA.addStaff({ name: "Kim", email: "kim@ml-a.test" });
    const lee = await repoA.addStaff({ name: "Lee", email: "lee@ml-a.test" });
    const kims = await repoA.createStaffNotification({
      staffMemberId: kim.id,
      type: "rostered",
      title: "Kim's",
    });
    expect(
      (await repoA.listStaffNotifications(lee.id)).map((n) => n.id),
    ).not.toContain(kims!.id);
    expect(await repoA.markStaffNotificationRead(kims!.id, lee.id)).toBeNull();
  });

  /* ----- COR-11: setup flags are membership-based ----- */

  it("counts a location as staffed when its only people are members, not homed there", async () => {
    const t2 = await makeOrgWithTwoLocations({ prefix: "ml-flags" });
    try {
      const repoA = createTenantRepo(t2.bizA);
      const person = await repoA.addStaff({
        name: "Mem",
        email: "mem@ml-flags.test",
      });
      // Before membership: B has nobody.
      expect((await createTenantRepo(t2.bizB).getSetupFlags()).hasStaff).toBe(
        false,
      );
      await createOrgRepo(t2.orgId).addPersonToLocation(person.id, t2.bizB);
      // After: B is staffed purely through staff_location.
      expect((await createTenantRepo(t2.bizB).getSetupFlags()).hasStaff).toBe(
        true,
      );
    } finally {
      await t2.cleanup();
    }
  });
});
