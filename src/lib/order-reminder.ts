import { isoWeekday, type DateOnly } from "@/lib/time";

/**
 * Pure order-reminder logic (inventory Part 2). No DB, no I/O — given suppliers,
 * the current stock status of each item, and today's business-local date, decide
 * which suppliers to remind the owner about and for which delivery date.
 *
 * The app NEVER places orders. This only selects what to put in a reminder email.
 *
 * Calendar dates are "YYYY-MM-DD" strings, which sort/subtract correctly as UTC
 * midnights; delivery weekdays are ISO 1–7 (1=Mon … 7=Sun), matching
 * `supplier.delivery_days` and `shift_template.weekdays`.
 */

export type StockStatus = "available" | "low" | "needs_order";

/** The two statuses that warrant an order reminder. `available` never does. */
export const ORDERABLE_STATUSES: readonly StockStatus[] = [
  "low",
  "needs_order",
];

/** Add `n` whole days to a "YYYY-MM-DD" date, returning a "YYYY-MM-DD". */
export function addDays(date: DateOnly, n: number): DateOnly {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/**
 * The soonest delivery date on or after `today` whose weekday is one of
 * `deliveryDays`, looking up to 7 days ahead. Null when no delivery days are
 * set. Used for display ("next delivery is …") and as a building block.
 */
export function nextDeliveryOnOrAfter(
  today: DateOnly,
  deliveryDays: number[],
): DateOnly | null {
  if (deliveryDays.length === 0) return null;
  const set = new Set(deliveryDays);
  for (let i = 0; i < 7; i++) {
    const candidate = addDays(today, i);
    if (set.has(isoWeekday(candidate))) return candidate;
  }
  return null;
}

/**
 * The delivery date this supplier should be ORDERED for TODAY, or null.
 *
 * The order-by date is `delivery − cutoff`, so it equals `today` exactly when the
 * delivery date is `today + cutoff`. We therefore look at the single date
 * `today + orderCutoffDaysBefore`: if it's a delivery weekday, that's the
 * delivery we remind for today; otherwise nothing is due today. This is correct
 * for multiple delivery days in a week and for cutoffs that span a week boundary
 * (plain date arithmetic), and a cutoff of 0 reminds on the delivery day itself.
 */
export function orderByDeliveryDate(
  today: DateOnly,
  deliveryDays: number[],
  cutoff: number,
): DateOnly | null {
  if (deliveryDays.length === 0) return null;
  const deliveryDate = addDays(today, cutoff);
  return deliveryDays.includes(isoWeekday(deliveryDate)) ? deliveryDate : null;
}

/** A supplier as the selector needs it. */
export type SupplierForReminder = {
  id: string;
  name: string;
  deliveryDays: number[];
  orderCutoffDaysBefore: number;
  lastOrderReminderDate: DateOnly | null;
};

/** An item with its CURRENT stock status (latest entry), supplier-linked. */
export type ItemStatusForReminder = {
  itemId: string;
  name: string;
  supplierId: string | null;
  status: StockStatus;
  quantity?: string | null;
};

export type ReminderItem = { name: string; quantity?: string | null };

/** One supplier to remind about, with its due delivery date and item lists. */
export type SupplierReminder = {
  supplierId: string;
  supplierName: string;
  deliveryDate: DateOnly;
  needsOrder: ReminderItem[];
  low: ReminderItem[];
};

/**
 * Choose which suppliers to remind the owner about today. For each supplier with
 * delivery days set, compute the delivery date due today (see
 * `orderByDeliveryDate`); skip if nothing is due, or if we already reminded for
 * that exact delivery date (`lastOrderReminderDate` — the idempotency cursor, so
 * a re-run the same day is a no-op and the next cycle re-arms). Then gather that
 * supplier's items whose current status is `needs_order` or `low`; a supplier is
 * only included when it has at least one such item.
 *
 * Pure and deterministic; the job handles emailing and advancing cursors.
 */
export function selectOrderReminders(
  suppliers: SupplierForReminder[],
  items: ItemStatusForReminder[],
  today: DateOnly,
): SupplierReminder[] {
  const reminders: SupplierReminder[] = [];

  for (const supplier of suppliers) {
    const deliveryDate = orderByDeliveryDate(
      today,
      supplier.deliveryDays,
      supplier.orderCutoffDaysBefore,
    );
    if (!deliveryDate) continue;
    // Already reminded for this delivery cycle.
    if (supplier.lastOrderReminderDate === deliveryDate) continue;

    const needsOrder: ReminderItem[] = [];
    const low: ReminderItem[] = [];
    for (const item of items) {
      if (item.supplierId !== supplier.id) continue;
      if (item.status === "needs_order")
        needsOrder.push({ name: item.name, quantity: item.quantity });
      else if (item.status === "low")
        low.push({ name: item.name, quantity: item.quantity });
    }
    if (needsOrder.length === 0 && low.length === 0) continue;

    reminders.push({
      supplierId: supplier.id,
      supplierName: supplier.name,
      deliveryDate,
      needsOrder,
      low,
    });
  }

  return reminders;
}
