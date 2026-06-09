import { describe, it, expect } from "vitest";
import {
  addDays,
  nextDeliveryOnOrAfter,
  orderByDeliveryDate,
  selectOrderReminders,
  type SupplierForReminder,
  type ItemStatusForReminder,
} from "@/lib/order-reminder";

/**
 * Pure order-reminder logic. Date anchors (all 2026-06):
 *   01 Mon(1) · 04 Thu(4) · 05 Fri(5) · 06 Sat(6) · 07 Sun(7) · 08 Mon(1) ·
 *   09 Tue(2) · 11 Thu(4)
 * The order-by date == today exactly when the delivery date is today+cutoff, so
 * these exercise the boundaries that matter: today is / isn't the order-by date,
 * multiple delivery days in a week, and a cutoff that spans the weekend.
 */

describe("addDays", () => {
  it("adds days across a month/week boundary", () => {
    expect(addDays("2026-06-06", 2)).toBe("2026-06-08");
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-06-08", 0)).toBe("2026-06-08");
  });
});

describe("nextDeliveryOnOrAfter", () => {
  it("finds the soonest delivery on or after today", () => {
    // Thursday delivery, starting Mon 01 → Thu 04.
    expect(nextDeliveryOnOrAfter("2026-06-01", [4])).toBe("2026-06-04");
  });
  it("counts today itself when today is a delivery day", () => {
    expect(nextDeliveryOnOrAfter("2026-06-01", [1])).toBe("2026-06-01");
  });
  it("returns null when there are no delivery days", () => {
    expect(nextDeliveryOnOrAfter("2026-06-01", [])).toBeNull();
  });
});

describe("orderByDeliveryDate", () => {
  it("returns the delivery date when today IS the order-by date", () => {
    // Mon delivery, cutoff 2, today Sat 06 → today+2 = Mon 08 (a delivery day).
    expect(orderByDeliveryDate("2026-06-06", [1], 2)).toBe("2026-06-08");
  });

  it("returns null when today is NOT the order-by date", () => {
    // Mon delivery, cutoff 2, today Fri 05 → today+2 = Sun 07 (not a delivery day).
    expect(orderByDeliveryDate("2026-06-05", [1], 2)).toBeNull();
  });

  it("handles multiple delivery days a literal 'next delivery' rule would miss", () => {
    // Deliveries Mon+Tue, cutoff 3, today Sat 06. Soonest delivery is Mon 08
    // (order-by Fri), but Tue 09's order-by IS today → remind for Tue 09.
    expect(orderByDeliveryDate("2026-06-06", [1, 2], 3)).toBe("2026-06-09");
  });

  it("handles a cutoff that spans the weekend", () => {
    // Mon delivery, cutoff 5, today Wed 03 → today+5 = Mon 08.
    expect(orderByDeliveryDate("2026-06-03", [1], 5)).toBe("2026-06-08");
  });

  it("reminds on the delivery day itself when cutoff is 0", () => {
    expect(orderByDeliveryDate("2026-06-04", [4], 0)).toBe("2026-06-04");
  });

  it("returns null when there are no delivery days", () => {
    expect(orderByDeliveryDate("2026-06-06", [], 2)).toBeNull();
  });
});

const mkSupplier = (
  over: Partial<SupplierForReminder> & { id: string },
): SupplierForReminder => ({
  name: over.id,
  deliveryDays: [1],
  orderCutoffDaysBefore: 2,
  lastOrderReminderDate: null,
  ...over,
});

describe("selectOrderReminders", () => {
  const TODAY = "2026-06-06"; // Sat → order-by for a Mon(1)+cutoff2 = Mon 08

  it("picks low + needs_order items per supplier and groups them", () => {
    const suppliers = [
      mkSupplier({ id: "s1", name: "Dairy Co" }),
      mkSupplier({
        id: "s2",
        name: "Bean Bros",
        deliveryDays: [4],
        orderCutoffDaysBefore: 0,
      }), // Thu, not due today
    ];
    const items: ItemStatusForReminder[] = [
      { itemId: "i1", name: "Milk", supplierId: "s1", status: "needs_order" },
      {
        itemId: "i2",
        name: "Cream",
        supplierId: "s1",
        status: "low",
        quantity: "1 tub",
      },
      { itemId: "i3", name: "Butter", supplierId: "s1", status: "available" },
      { itemId: "i4", name: "Beans", supplierId: "s2", status: "needs_order" },
    ];
    const out = selectOrderReminders(suppliers, items, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      supplierId: "s1",
      supplierName: "Dairy Co",
      deliveryDate: "2026-06-08",
    });
    expect(out[0]!.needsOrder.map((i) => i.name)).toEqual(["Milk"]);
    expect(out[0]!.low).toEqual([{ name: "Cream", quantity: "1 tub" }]);
  });

  it("is idempotent: skips a supplier already reminded for that delivery date", () => {
    const suppliers = [
      mkSupplier({ id: "s1", lastOrderReminderDate: "2026-06-08" }),
    ];
    const items: ItemStatusForReminder[] = [
      { itemId: "i1", name: "Milk", supplierId: "s1", status: "needs_order" },
    ];
    expect(selectOrderReminders(suppliers, items, TODAY)).toEqual([]);
  });

  it("re-arms once the due delivery date differs from the cursor", () => {
    // Cursor points at last week's delivery; this week's is 06-08 → still fires.
    const suppliers = [
      mkSupplier({ id: "s1", lastOrderReminderDate: "2026-06-01" }),
    ];
    const items: ItemStatusForReminder[] = [
      { itemId: "i1", name: "Milk", supplierId: "s1", status: "low" },
    ];
    const out = selectOrderReminders(suppliers, items, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]!.deliveryDate).toBe("2026-06-08");
  });

  it("excludes a supplier due today with no low/needs_order items", () => {
    const suppliers = [mkSupplier({ id: "s1" })];
    const items: ItemStatusForReminder[] = [
      { itemId: "i1", name: "Milk", supplierId: "s1", status: "available" },
    ];
    expect(selectOrderReminders(suppliers, items, TODAY)).toEqual([]);
  });

  it("skips suppliers with no delivery days and ones not due today", () => {
    const suppliers = [
      mkSupplier({ id: "s1", deliveryDays: [] }),
      mkSupplier({ id: "s2", deliveryDays: [4], orderCutoffDaysBefore: 2 }), // due Tue not Sat
    ];
    const items: ItemStatusForReminder[] = [
      { itemId: "i1", name: "X", supplierId: "s1", status: "needs_order" },
      { itemId: "i2", name: "Y", supplierId: "s2", status: "needs_order" },
    ];
    expect(selectOrderReminders(suppliers, items, TODAY)).toEqual([]);
  });
});
