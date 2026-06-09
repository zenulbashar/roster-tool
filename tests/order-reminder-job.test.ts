import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, users } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { handleOrderReminders } from "@/lib/jobs/handlers";

/**
 * Integration coverage of the daily order-reminder job: it picks the right items
 * per supplier on the order-by day, consolidates a business's suppliers into ONE
 * email, is idempotent per delivery date (no resend same day; re-arms next
 * cycle), is per-business scoped, and skips owner-less businesses.
 *
 * Runs against a local Postgres (Docker may be unavailable; uses DATABASE_URL —
 * a local cluster — and does not skip silently). All businesses use UTC so
 * `businessDateOf(now)` is the UTC date.
 *
 * Anchors: 2026-06-08 Mon(1), order-by for a Mon delivery + cutoff 2 is Sat
 * 2026-06-06; a Thu(4) delivery + cutoff 2 is order-by Tue 2026-06-09.
 */
function at(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

const OWNER_EMAILS = ["order-owner-a@stock.test", "order-owner-b@stock.test"];

describe("order reminder job", () => {
  let bizA = ""; // has an owner, suppliers due Sat
  let bizB = ""; // has an owner, separate tenant
  let bizNoOwner = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let supDairy = "";
  let supBean = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Order Co A", timezone: "UTC" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Order Co B", timezone: "UTC" })
      .returning();
    const [n] = await db
      .insert(businesses)
      .values({ name: "Order No Owner", timezone: "UTC" })
      .returning();
    bizA = a!.id;
    bizB = b!.id;
    bizNoOwner = n!.id;
    repoA = createTenantRepo(bizA);
    repoB = createTenantRepo(bizB);
    await db
      .insert(users)
      .values({ email: OWNER_EMAILS[0]!, businessId: bizA });
    await db
      .insert(users)
      .values({ email: OWNER_EMAILS[1]!, businessId: bizB });
    // bizNoOwner intentionally has no user.

    // Business A: two suppliers both delivering Mon (cutoff 2 → order-by Sat).
    supDairy = (
      await repoA.addSupplier({
        name: "Dairy Co",
        deliveryDays: [1],
        orderCutoffDaysBefore: 2,
      })
    ).id;
    supBean = (
      await repoA.addSupplier({
        name: "Bean Bros",
        deliveryDays: [4], // Thu → order-by Tue, NOT Sat
        orderCutoffDaysBefore: 2,
      })
    ).id;

    const milk = await repoA.addItem({ name: "Milk", supplierId: supDairy });
    const cream = await repoA.addItem({ name: "Cream", supplierId: supDairy });
    await repoA.addItem({ name: "Butter", supplierId: supDairy }); // stays available
    const beans = await repoA.addItem({ name: "Beans", supplierId: supBean });

    await repoA.recordStockCheck(
      [
        { itemId: milk.id, status: "needs_order" },
        { itemId: cream.id, status: "low", quantity: "1 tub" },
        { itemId: beans.id, status: "needs_order" },
      ],
      { checkedByStaffId: null, checkedAt: at("2026-06-05") },
    );

    // Business B: a supplier due Sat with an item, to prove per-tenant scoping.
    const supB = await repoB.addSupplier({
      name: "B Supplier",
      deliveryDays: [1],
      orderCutoffDaysBefore: 2,
    });
    const bItem = await repoB.addItem({ name: "B Item", supplierId: supB.id });
    await repoB.recordStockCheck([{ itemId: bItem.id, status: "low" }], {
      checkedByStaffId: null,
      checkedAt: at("2026-06-05"),
    });
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, OWNER_EMAILS));
    for (const id of [bizA, bizB, bizNoOwner]) {
      if (id) await db.delete(businesses).where(eq(businesses.id, id));
    }
    await db.$client.end();
  });

  function sentTo(send: ReturnType<typeof vi.fn>, to: string) {
    return send.mock.calls
      .map((c) => c[0] as { to: string; subject: string; text: string })
      .filter((e) => e.to === to);
  }

  it("emails one consolidated reminder for the suppliers due today", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const SAT = at("2026-06-06");
    const count = await handleOrderReminders(SAT, { send });
    expect(count).toBeGreaterThanOrEqual(2); // Dairy (A) + B Supplier (B)

    const aEmails = sentTo(send, OWNER_EMAILS[0]!);
    expect(aEmails).toHaveLength(1); // ONE consolidated email for business A
    const body = aEmails[0]!.text;
    expect(body).toContain("Dairy Co");
    expect(body).toContain("Milk");
    expect(body).toContain("Cream");
    expect(body).toContain("1 tub");
    // Bean Bros delivers Thu (order-by Tue), so it's NOT in today's email.
    expect(body).not.toContain("Bean Bros");
    // available item never appears.
    expect(body).not.toContain("Butter");

    // Business B got its own separate email; no cross-tenant leakage.
    const bEmails = sentTo(send, OWNER_EMAILS[1]!);
    expect(bEmails).toHaveLength(1);
    expect(bEmails[0]!.text).toContain("B Item");
    expect(bEmails[0]!.text).not.toContain("Milk");
  });

  it("is idempotent: a second run the same day sends nothing", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const count = await handleOrderReminders(at("2026-06-06"), { send });
    expect(count).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("re-arms for the next delivery cycle (next week's order-by day)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    // Next Saturday (order-by for Mon 2026-06-15). Items are still flagged.
    const count = await handleOrderReminders(at("2026-06-13"), { send });
    const aEmails = sentTo(send, OWNER_EMAILS[0]!);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(aEmails).toHaveLength(1);
    expect(aEmails[0]!.text).toContain("Dairy Co");
  });

  it("skips owner-less businesses (no email, no error)", async () => {
    // bizNoOwner has a due supplier+item but no user → must be skipped.
    const repoN = createTenantRepo(bizNoOwner);
    const sup = await repoN.addSupplier({
      name: "Ghost Supplier",
      deliveryDays: [1],
      orderCutoffDaysBefore: 2,
    });
    const item = await repoN.addItem({
      name: "Ghost Item",
      supplierId: sup.id,
    });
    await repoN.recordStockCheck([{ itemId: item.id, status: "needs_order" }], {
      checkedByStaffId: null,
      checkedAt: at("2026-06-12"),
    });
    const send = vi.fn().mockResolvedValue(undefined);
    await handleOrderReminders(at("2026-06-20"), { send });
    const ghost = send.mock.calls
      .map((c) => c[0] as { text: string })
      .filter((e) => e.text.includes("Ghost"));
    expect(ghost).toHaveLength(0);
  });
});
