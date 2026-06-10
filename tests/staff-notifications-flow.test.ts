import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { resolveNoticesStaff } from "@/lib/tenant/notices-access";
import { notifyStaff } from "@/lib/staff-notifications";
import { generateToken } from "@/lib/tokens";

/**
 * Integration coverage for the staff-notice data layer: per-staff AND
 * per-tenant isolation of every read/write, dedupe-key idempotency, the /me
 * token resolver (unknown + rotated tokens rejected, inactive staff don't
 * resolve), and notifyStaff's best-effort contract. Requires a local Postgres
 * (see CI / README).
 */
describe("staff notifications flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let ava = ""; // staff in A
  let ben = ""; // staff in A
  let zoe = ""; // staff in B

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Notices Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Notices Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    ava = (await repoA.addStaff({ name: "Ava", email: "ava@notices-a.test" }))
      .id;
    ben = (await repoA.addStaff({ name: "Ben", email: "ben@notices-a.test" }))
      .id;
    zoe = (await repoB.addStaff({ name: "Zoe", email: "zoe@notices-b.test" }))
      .id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
  });

  it("scopes list/count to one staff member in one business", async () => {
    await repoA.createStaffNotification({
      staffMemberId: ava,
      type: "leave_decided",
      title: "Your leave was approved",
    });
    await repoA.createStaffNotification({
      staffMemberId: ben,
      type: "rostered",
      title: "You've been rostered",
    });
    await repoB.createStaffNotification({
      staffMemberId: zoe,
      type: "rostered",
      title: "You've been rostered",
    });

    const avas = await repoA.listStaffNotifications(ava);
    expect(avas.map((n) => n.title)).toEqual(["Your leave was approved"]);
    expect(await repoA.countUnreadStaffNotifications(ava)).toBe(1);
    expect(await repoA.countUnreadStaffNotifications(ben)).toBe(1);
    // B's repo never sees A's staff, even with A's staff id.
    expect(await repoB.listStaffNotifications(ava)).toEqual([]);
    expect(await repoB.countUnreadStaffNotifications(ava)).toBe(0);
  });

  it("mark-read is scoped: foreign staff or tenant ids no-op", async () => {
    const mine = await repoA.createStaffNotification({
      staffMemberId: ava,
      type: "shift_swap_approved",
      title: "You got the shift",
    });

    // Ben (same business) can't mark Ava's notice; nor can business B.
    expect(await repoA.markStaffNotificationRead(mine!.id, ben)).toBeNull();
    expect(await repoB.markStaffNotificationRead(mine!.id, zoe)).toBeNull();
    const still = await repoA.listStaffNotifications(ava);
    expect(still.find((n) => n.id === mine!.id)?.isRead).toBe(false);

    // The owner of the notice can.
    expect((await repoA.markStaffNotificationRead(mine!.id, ava))?.isRead).toBe(
      true,
    );
  });

  it("mark-all-read clears only that staff member's notices", async () => {
    await repoA.markAllStaffNotificationsRead(ava);
    expect(await repoA.countUnreadStaffNotifications(ava)).toBe(0);
    expect(await repoA.countUnreadStaffNotifications(ben)).toBe(1);
    expect(await repoB.countUnreadStaffNotifications(zoe)).toBe(1);
  });

  it("a repeated dedupeKey is a silent no-op (reminder idempotency)", async () => {
    const key = `shift_reminder:${ava}:2026-06-11`;
    const firstInsert = await repoA.createStaffNotification({
      staffMemberId: ava,
      type: "shift_reminder",
      title: "You work tomorrow",
      dedupeKey: key,
    });
    const repeat = await repoA.createStaffNotification({
      staffMemberId: ava,
      type: "shift_reminder",
      title: "You work tomorrow",
      dedupeKey: key,
    });
    expect(firstInsert).not.toBeNull();
    expect(repeat).toBeNull();
    const reminders = (await repoA.listStaffNotifications(ava)).filter(
      (n) => n.dedupeKey === key,
    );
    expect(reminders).toHaveLength(1);
  });

  it("resolves the notices token to exactly one staff member", async () => {
    const { token, tokenHash } = generateToken();
    await repoA.setStaffNoticesTokenHash(ava, tokenHash);

    const resolved = await resolveNoticesStaff(token);
    expect(resolved).toMatchObject({
      businessId: businessA,
      staffMemberId: ava,
      staffName: "Ava",
      businessName: "Notices Biz A",
    });
    expect(await resolveNoticesStaff("not-a-real-token")).toBeNull();
    expect(await resolveNoticesStaff("")).toBeNull();
  });

  it("rotating the token revokes the old link", async () => {
    const oldLink = generateToken();
    await repoA.setStaffNoticesTokenHash(ben, oldLink.tokenHash);
    expect(await resolveNoticesStaff(oldLink.token)).not.toBeNull();

    const newLink = generateToken();
    await repoA.setStaffNoticesTokenHash(ben, newLink.tokenHash);
    expect(await resolveNoticesStaff(oldLink.token)).toBeNull();
    expect(await resolveNoticesStaff(newLink.token)).not.toBeNull();
  });

  it("an inactive (removed) staff member's link stops resolving", async () => {
    const link = generateToken();
    await repoB.setStaffNoticesTokenHash(zoe, link.tokenHash);
    expect(await resolveNoticesStaff(link.token)).not.toBeNull();
    await repoB.updateStaff(zoe, { active: false });
    expect(await resolveNoticesStaff(link.token)).toBeNull();
    await repoB.updateStaff(zoe, { active: true });
  });

  it("setStaffNoticesTokenHash is tenant-scoped", async () => {
    const { tokenHash } = generateToken();
    // Business B can't set a token on A's staff member.
    expect(await repoB.setStaffNoticesTokenHash(ava, tokenHash)).toBeNull();
  });

  it("notifyStaff never throws when the insert fails", async () => {
    const broken = {
      ...repoA,
      createStaffNotification: async () => {
        throw new Error("boom");
      },
    } as TenantRepo;
    await expect(
      notifyStaff(broken, {
        staffMemberId: ava,
        type: "rostered",
        title: "You've been rostered",
      }),
    ).resolves.toBeUndefined();
    // And the happy path inserts.
    await notifyStaff(repoA, {
      staffMemberId: ava,
      type: "rostered",
      title: "You've been rostered — week of 15/06",
      body: "3 shifts",
    });
    const rows = await repoA.listStaffNotifications(ava);
    expect(rows.some((n) => n.title.includes("week of 15/06"))).toBe(true);
  });
});
