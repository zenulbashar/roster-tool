import type { TenantRepo } from "@/lib/tenant/repository";
import {
  verifyPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  PIN_LOCKOUT_MS,
} from "@/lib/pin";
import { pinSchema, stockStatusSchema } from "@/lib/validation";
import type { StockStatus } from "@/lib/order-reminder";
import { notifyOwner } from "@/lib/notifications";

/**
 * Result of a staff stock check, shaped like the other PIN flows so the shared
 * client form can drive it with `useActionState`.
 */
export type StockCheckResult =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * Shared core for a staff member submitting a stock check, used by BOTH the
 * personal-phone (`/clock`) and shared-kiosk (`/kiosk`) PIN flows. The caller
 * resolves the business from its own capability token and passes a tenant-scoped
 * `repo` — the business is NEVER taken from client input. The staff member is
 * authenticated by the same PIN + per-staff brute-force cooldown as clock-in.
 *
 * No geofence (checking stock isn't a clock action). The set of items comes from
 * the repo (this business's ACTIVE items), so item ids are never trusted from the
 * client; the form only supplies a status per item. Items left unset are skipped
 * — their previous status stands. Each set item records a `stock_check_entry`.
 */
export async function submitStockCheck(
  repo: TenantRepo,
  formData: FormData,
  now: Date = new Date(),
): Promise<StockCheckResult> {
  const staffId = formData.get("staffId");
  const pinParsed = pinSchema.safeParse(formData.get("pin"));
  if (typeof staffId !== "string" || !staffId || !pinParsed.success) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

  const staff = await repo.getStaff(staffId);
  // Same generic message whether the person is missing, inactive or PIN-less.
  if (!staff || !staff.active || !staff.pinHash) {
    return { status: "error", message: "That PIN didn't match. Try again." };
  }

  const lock = isLockedOut(
    {
      failedPinAttempts: staff.failedPinAttempts,
      pinLockedUntil: staff.pinLockedUntil,
    },
    now,
  );
  if (lock.locked) {
    const secs = Math.ceil(lock.retryAfterMs / 1000);
    return {
      status: "error",
      message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
    };
  }

  if (!verifyPin(pinParsed.data, staff.pinHash)) {
    const next = registerFailedAttempt(
      {
        failedPinAttempts: staff.failedPinAttempts,
        pinLockedUntil: staff.pinLockedUntil,
      },
      now,
    );
    await repo.updateStaffLockout(staff.id, next);
    if (next.pinLockedUntil) {
      const secs = Math.ceil(PIN_LOCKOUT_MS / 1000);
      return {
        status: "error",
        message: `Too many wrong PINs. Please wait ${secs}s and try again.`,
      };
    }
    return { status: "error", message: "That PIN didn't match. Try again." };
  }

  // Correct PIN: wipe the brute-force counter.
  await repo.updateStaffLockout(staff.id, clearedLockout());

  // Read a status per ACTIVE item (ids come from the repo, never the client).
  const activeItems = await repo.listActiveItemsForStockCheck();
  const entries: Array<{
    itemId: string;
    status: StockStatus;
    quantity?: string | null;
  }> = [];
  for (const item of activeItems) {
    const raw = formData.get(`status_${item.id}`);
    const parsed = stockStatusSchema.safeParse(raw);
    if (!parsed.success) continue; // unset / "leave unchanged" / invalid → skip
    const qtyRaw = formData.get(`qty_${item.id}`);
    const quantity =
      typeof qtyRaw === "string" && qtyRaw.trim().length > 0
        ? qtyRaw.trim().slice(0, 40)
        : null;
    entries.push({ itemId: item.id, status: parsed.data, quantity });
  }

  if (entries.length === 0) {
    return {
      status: "error",
      message: "Set the status of at least one item, then submit.",
    };
  }

  const recorded = await repo.recordStockCheck(entries, {
    checkedByStaffId: staff.id,
    checkedAt: now,
  });
  if (recorded === 0) {
    return { status: "error", message: "Couldn't save. Try again." };
  }

  // Best-effort owner notification when this check flags anything to order.
  const needsOrder = entries.filter((e) => e.status === "needs_order").length;
  if (needsOrder > 0) {
    await notifyOwner(repo, {
      type: "stock_needs_order",
      title: `${staff.name} flagged stock to order`,
      body: `${needsOrder} item${needsOrder === 1 ? "" : "s"} need${needsOrder === 1 ? "s" : ""} ordering.`,
      linkPath: "/app/stock",
    });
  }

  return {
    status: "success",
    message: `Thanks ${staff.name}, you updated ${recorded} item${
      recorded === 1 ? "" : "s"
    }. Your manager will see what needs ordering.`,
  };
}
