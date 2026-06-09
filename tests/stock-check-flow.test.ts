import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { submitStockCheck } from "@/lib/stock-check-submission";
import { hashPin } from "@/lib/pin";

/**
 * Integration coverage of stock checks against the real DB: recording entries
 * (tenant-scoped, current = latest), the owner manual override, the foreign /
 * inactive item guard, tenant isolation, and the PIN-gated staff submission core.
 *
 * Runs against a local Postgres (Docker may be unavailable; uses DATABASE_URL —
 * a local cluster — and does not skip silently).
 */
describe("stock check flow", () => {
  let bizA = "";
  let bizB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let supA = "";
  let itemA1 = "";
  let itemA2 = "";
  let staffA = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Stock2 Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Stock2 Café B" })
      .returning();
    bizA = a!.id;
    bizB = b!.id;
    repoA = createTenantRepo(bizA);
    repoB = createTenantRepo(bizB);
    supA = (
      await repoA.addSupplier({
        name: "Dairy Co",
        deliveryDays: [1],
        orderCutoffDaysBefore: 1,
      })
    ).id;
    itemA1 = (
      await repoA.addItem({ name: "Milk", unit: "each", supplierId: supA })
    ).id;
    itemA2 = (await repoA.addItem({ name: "Bread" })).id;
    const staff = await repoA.addStaff({ name: "Ava", email: "ava@a.test" });
    staffA = staff.id;
    await repoA.setStaffPin(staffA, hashPin("1234"));
  });

  afterAll(async () => {
    if (bizA) await db.delete(businesses).where(eq(businesses.id, bizA));
    if (bizB) await db.delete(businesses).where(eq(businesses.id, bizB));
    await db.$client.end();
  });

  it("records a stock check and reads current status from the latest entry", async () => {
    const n = await repoA.recordStockCheck(
      [
        { itemId: itemA1, status: "low", quantity: "1 bottle" },
        { itemId: itemA2, status: "available" },
      ],
      { checkedByStaffId: staffA, checkedAt: new Date("2026-06-06T00:00:00Z") },
    );
    expect(n).toBe(2);

    // A later check on Milk supersedes the earlier one.
    await repoA.recordStockCheck([{ itemId: itemA1, status: "needs_order" }], {
      checkedByStaffId: staffA,
      checkedAt: new Date("2026-06-07T00:00:00Z"),
    });

    const statuses = await repoA.itemsWithCurrentStatus();
    const milk = statuses.find((s) => s.itemId === itemA1);
    const bread = statuses.find((s) => s.itemId === itemA2);
    expect(milk?.status).toBe("needs_order");
    expect(milk?.checkedByName).toBe("Ava");
    expect(milk?.supplierName).toBe("Dairy Co");
    expect(bread?.status).toBe("available");
  });

  it("owner manual override records an entry with no checker (null)", async () => {
    await repoA.recordStockCheck([{ itemId: itemA2, status: "low" }], {
      checkedByStaffId: null,
      checkedAt: new Date("2026-06-08T00:00:00Z"),
    });
    const statuses = await repoA.itemsWithCurrentStatus();
    const bread = statuses.find((s) => s.itemId === itemA2);
    expect(bread?.status).toBe("low");
    expect(bread?.checkedByStaffId).toBeNull();
    expect(bread?.checkedByName).toBeNull();
  });

  it("drops foreign and inactive item ids (never records them)", async () => {
    const foreignItem = (await repoB.addItem({ name: "Other biz item" })).id;
    const inactive = (await repoA.addItem({ name: "Retired" })).id;
    await repoA.setItemActive(inactive, false);

    const n = await repoA.recordStockCheck([
      { itemId: foreignItem, status: "needs_order" },
      { itemId: inactive, status: "needs_order" },
      { itemId: itemA1, status: "available" },
    ]);
    expect(n).toBe(1); // only the valid active item in this business

    // Business B's item never gained an entry via A's repo (status stays null).
    const bStatuses = await repoB.itemsWithCurrentStatus();
    expect(bStatuses.find((s) => s.itemId === foreignItem)?.status).toBeNull();
  });

  it("isolates current-status reads per tenant", async () => {
    const aIds = (await repoA.itemsWithCurrentStatus()).map((s) => s.itemId);
    expect(aIds).toContain(itemA1);
    const bIds = (await repoB.itemsWithCurrentStatus()).map((s) => s.itemId);
    expect(bIds).not.toContain(itemA1);
  });

  it("marks a supplier's order-reminder cursor within the business only", async () => {
    expect(
      await repoB.markSupplierOrderReminded(supA, "2026-06-08"),
    ).toBeNull();
    const updated = await repoA.markSupplierOrderReminded(supA, "2026-06-08");
    expect(updated?.lastOrderReminderDate).toBe("2026-06-08");
    const forReminder = await repoA.listSuppliersForReminder();
    expect(forReminder.find((s) => s.id === supA)?.lastOrderReminderDate).toBe(
      "2026-06-08",
    );
  });

  it("records a staff stock check via the PIN-gated core", async () => {
    const fd = new FormData();
    fd.set("staffId", staffA);
    fd.set("pin", "1234");
    fd.set(`status_${itemA1}`, "low");
    fd.set(`qty_${itemA1}`, "2 left");
    fd.set(`status_${itemA2}`, ""); // untouched → not recorded
    const res = await submitStockCheck(repoA, fd, new Date());
    expect(res.status).toBe("success");

    const milk = (await repoA.itemsWithCurrentStatus()).find(
      (s) => s.itemId === itemA1,
    );
    expect(milk?.status).toBe("low");
    expect(milk?.quantity).toBe("2 left");
  });

  it("rejects a wrong PIN and records nothing", async () => {
    const fd = new FormData();
    fd.set("staffId", staffA);
    fd.set("pin", "0000");
    fd.set(`status_${itemA1}`, "needs_order");
    const res = await submitStockCheck(repoA, fd, new Date());
    expect(res.status).toBe("error");
    // Status unchanged from the previous successful "low".
    const milk = (await repoA.itemsWithCurrentStatus()).find(
      (s) => s.itemId === itemA1,
    );
    expect(milk?.status).toBe("low");
  });

  it("errors when no items were set", async () => {
    const fd = new FormData();
    fd.set("staffId", staffA);
    fd.set("pin", "1234");
    fd.set(`status_${itemA1}`, "");
    fd.set(`status_${itemA2}`, "");
    const res = await submitStockCheck(repoA, fd, new Date());
    expect(res.status).toBe("error");
  });
});
