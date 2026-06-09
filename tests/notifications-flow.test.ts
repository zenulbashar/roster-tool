import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { notifyOwner } from "@/lib/notifications";

/**
 * Integration coverage for the notification data layer + the best-effort,
 * preference-gated `notifyOwner` wrapper. Requires a local Postgres (Docker may
 * be unavailable; see PR notes).
 */
describe("notifications flow", () => {
  let businessA = "";
  let businessB = "";

  beforeEach(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Notif Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Notif Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("creates, lists newest-first, counts unread, and marks read", async () => {
    const repo = createTenantRepo(businessA);
    await repo.createNotification({ type: "leave_requested", title: "first" });
    const second = await repo.createNotification({
      type: "stock_needs_order",
      title: "second",
      body: "2 items",
      linkPath: "/app/stock",
    });

    const recent = await repo.listRecentNotifications();
    expect(recent.map((n) => n.title)).toEqual(["second", "first"]);
    expect(await repo.countUnreadNotifications()).toBe(2);

    await repo.markNotificationRead(second.id);
    expect(await repo.countUnreadNotifications()).toBe(1);

    await repo.markAllNotificationsRead();
    expect(await repo.countUnreadNotifications()).toBe(0);
  });

  it("is tenant-isolated: B can't see or mark A's notifications", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const a = await repoA.createNotification({
      type: "cert_expiring",
      title: "A only",
    });

    expect(await repoB.listRecentNotifications()).toHaveLength(0);
    expect(await repoB.countUnreadNotifications()).toBe(0);

    // Marking A's row from B's repo no-ops; A's stays unread.
    expect(await repoB.markNotificationRead(a.id)).toBeNull();
    expect(await repoA.countUnreadNotifications()).toBe(1);

    // Mark-all on B doesn't touch A.
    await repoB.markAllNotificationsRead();
    expect(await repoA.countUnreadNotifications()).toBe(1);
  });

  it("notifyOwner inserts when the type is enabled (default)", async () => {
    const repo = createTenantRepo(businessA);
    await notifyOwner(repo, {
      type: "availability_reply",
      title: "Ava sent availability",
      linkPath: "/app/periods/x",
    });
    const recent = await repo.listRecentNotifications();
    expect(recent).toHaveLength(1);
    expect(recent[0]!.type).toBe("availability_reply");
  });

  it("notifyOwner skips insert when the type is disabled", async () => {
    const repo = createTenantRepo(businessA);
    await repo.updateNotificationPrefs({ notifyLeaveRequested: false });
    await notifyOwner(repo, { type: "leave_requested", title: "muted" });
    expect(await repo.listRecentNotifications()).toHaveLength(0);

    // A different, still-enabled type is unaffected.
    await notifyOwner(repo, { type: "cert_expiring", title: "kept" });
    expect(await repo.listRecentNotifications()).toHaveLength(1);
  });

  it("updateNotificationPrefs persists", async () => {
    const repo = createTenantRepo(businessA);
    await repo.updateNotificationPrefs({
      notifyStockNeedsOrder: false,
      notifyCertExpiring: false,
    });
    const biz = await repo.getBusiness();
    expect(biz?.notifyStockNeedsOrder).toBe(false);
    expect(biz?.notifyCertExpiring).toBe(false);
    expect(biz?.notifyLeaveRequested).toBe(true);
  });

  it("notifyOwner is best-effort: a failing insert never throws", async () => {
    // A repo whose getBusiness returns an enabled business but whose insert
    // throws — notifyOwner must swallow it.
    const repo = createTenantRepo(businessA);
    const broken = {
      businessId: businessA,
      getBusiness: repo.getBusiness,
      createNotification: () => {
        throw new Error("insert boom");
      },
    } as unknown as TenantRepo;

    await expect(
      notifyOwner(broken, { type: "leave_requested", title: "x" }),
    ).resolves.toBeUndefined();
    // Nothing was written.
    expect(await repo.listRecentNotifications()).toHaveLength(0);
  });
});
