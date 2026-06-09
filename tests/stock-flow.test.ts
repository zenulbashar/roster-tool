import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { buildImportPreview, itemsToInsert } from "@/lib/item-import";

/**
 * Integration coverage of supplier + item CRUD against the real DB: tenant
 * isolation on every owner action, supplier→item set-null on supplier delete,
 * the cross-tenant supplier guard, and the CSV import path end-to-end
 * (pure preview → bulk insert), all scoped to one business.
 *
 * Runs against a local Postgres (Docker may be unavailable; the suite uses the
 * DATABASE_URL from .env — a local cluster — and does not skip silently).
 */
describe("stock (suppliers + items) flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Stock Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Stock Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("adds a supplier scoped to the business with delivery days", async () => {
    const sup = await repoA.addSupplier({
      name: "Dairy Co",
      contactName: "Pat",
      email: "orders@dairy.test",
      phone: "0400 000 000",
      deliveryDays: [1, 3, 5],
      orderCutoffDaysBefore: 2,
      notes: "Leave at back door",
    });
    expect(sup.businessId).toBe(businessA);
    expect(sup.deliveryDays).toEqual([1, 3, 5]);
    expect(sup.orderCutoffDaysBefore).toBe(2);

    const list = await repoA.listSuppliers();
    expect(list.some((s) => s.id === sup.id)).toBe(true);
    // Business B sees none of A's suppliers.
    expect(await repoB.listSuppliers()).toHaveLength(0);
  });

  it("updates and deletes a supplier only within the business", async () => {
    const sup = await repoA.addSupplier({
      name: "Temp Supplier",
      deliveryDays: [],
      orderCutoffDaysBefore: 1,
    });
    // B cannot update A's supplier.
    expect(
      await repoB.updateSupplier(sup.id, {
        name: "Hacked",
        deliveryDays: [],
        orderCutoffDaysBefore: 1,
      }),
    ).toBeNull();
    const updated = await repoA.updateSupplier(sup.id, {
      name: "Renamed Supplier",
      deliveryDays: [2],
      orderCutoffDaysBefore: 3,
    });
    expect(updated?.name).toBe("Renamed Supplier");

    // B's delete is a no-op on A's row; A's delete removes it.
    await repoB.deleteSupplier(sup.id);
    expect(await repoA.getSupplier(sup.id)).not.toBeNull();
    await repoA.deleteSupplier(sup.id);
    expect(await repoA.getSupplier(sup.id)).toBeNull();
  });

  it("adds an item linked to a supplier and lists with the supplier name", async () => {
    const sup = await repoA.addSupplier({
      name: "Bean Bros",
      deliveryDays: [2, 4],
      orderCutoffDaysBefore: 1,
    });
    const item = await repoA.addItem({
      name: "Coffee beans 1kg",
      skuCode: "BN-1",
      unit: "kg",
      supplierId: sup.id,
    });
    expect(item.businessId).toBe(businessA);
    expect(item.supplierId).toBe(sup.id);

    const listed = await repoA.listItems();
    const row = listed.find((i) => i.id === item.id);
    expect(row?.supplierName).toBe("Bean Bros");
    expect(await repoB.listItems()).toHaveLength(0);
  });

  it("refuses to link an item to another tenant's supplier", async () => {
    const supB = await repoB.addSupplier({
      name: "Foreign Supplier",
      deliveryDays: [],
      orderCutoffDaysBefore: 1,
    });
    // A tries to attach B's supplier — the guard coerces it to null.
    const item = await repoA.addItem({
      name: "Mystery item",
      supplierId: supB.id,
    });
    expect(item.supplierId).toBeNull();
    await repoB.deleteSupplier(supB.id);
  });

  it("nulls an item's supplier when the supplier is deleted (set null)", async () => {
    const sup = await repoA.addSupplier({
      name: "Disappearing Supplier",
      deliveryDays: [],
      orderCutoffDaysBefore: 1,
    });
    const item = await repoA.addItem({
      name: "Linked item",
      supplierId: sup.id,
    });
    await repoA.deleteSupplier(sup.id);
    const after = await repoA.getItem(item.id);
    expect(after).not.toBeNull();
    expect(after!.supplierId).toBeNull();
  });

  it("deactivates and reactivates an item; activeOnly filters it", async () => {
    const item = await repoA.addItem({ name: "Seasonal item" });
    await repoA.setItemActive(item.id, false);
    const activeIds = (await repoA.listItems({ activeOnly: true })).map(
      (i) => i.id,
    );
    expect(activeIds).not.toContain(item.id);
    await repoA.setItemActive(item.id, true);
    const activeIds2 = (await repoA.listItems({ activeOnly: true })).map(
      (i) => i.id,
    );
    expect(activeIds2).toContain(item.id);
  });

  it("imports a CSV end-to-end: preview (pure) then bulk insert (scoped)", async () => {
    // Fresh business so dedupe/counts are clean.
    const [c] = await db
      .insert(businesses)
      .values({ name: "Stock Café C" })
      .returning();
    const repoC = createTenantRepo(c!.id);
    try {
      const sup = await repoC.addSupplier({
        name: "Dairy Co",
        deliveryDays: [1],
        orderCutoffDaysBefore: 1,
      });
      // Seed an existing item so the importer dedupes it.
      await repoC.addItem({ name: "Existing item", skuCode: "EX-1" });

      const csv = [
        "name,sku_code,unit,supplier_name",
        "Milk 2L,MLK-2L,each,dairy co", // matched supplier (case-insensitive)
        "Bread,BRD,each,Unknown", // unmatched supplier -> no link
        "Existing item,NEW,box,", // duplicate by name -> skipped
        ",NOSKU,,", // missing name -> error
      ].join("\n");

      const [suppliersForMatch, existingItems] = await Promise.all([
        repoC.listSuppliersForMatch(),
        repoC.listItemKeysForDedupe(),
      ]);
      const preview = buildImportPreview(csv, {
        suppliers: suppliersForMatch,
        existingItems,
      });
      expect(preview.counts).toMatchObject({
        toAdd: 2,
        duplicates: 1,
        errors: 1,
        suppliersMatched: 1,
        suppliersUnmatched: 1,
      });

      const inserted = await repoC.bulkInsertItems(itemsToInsert(preview));
      expect(inserted).toHaveLength(2);

      const all = await repoC.listItems();
      const milk = all.find((i) => i.name === "Milk 2L");
      const bread = all.find((i) => i.name === "Bread");
      expect(milk?.supplierId).toBe(sup.id);
      expect(bread?.supplierId).toBeNull();
      // The duplicate and the error row were not inserted.
      expect(all.filter((i) => i.name === "Existing item")).toHaveLength(1);
    } finally {
      await db.delete(businesses).where(eq(businesses.id, c!.id));
    }
  });
});
