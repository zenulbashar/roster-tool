import { createHash } from "node:crypto";

/**
 * Deterministic idempotency keys for Xero timesheet creates (#16).
 *
 * TWO layers of de-dupe protection, by design:
 *
 *  1. The DURABLE `UNIQUE (business_id, staff_member_id, period_start,
 *     period_end)` row in `xero_timesheet_push` is the long-window guard — it
 *     outlives Xero's Idempotency-Key retention (~24h) and is what actually
 *     stops a second draft for the same period.
 *
 *  2. Xero's `Idempotency-Key` header protects a SINGLE create attempt against a
 *     network retry (Xero returns the same response instead of a duplicate).
 *
 * The KEY SUBTLETY (2.0 delete-then-recreate): re-push DELETEs the old draft and
 * CREATEs a new one. If the new create reused the old create's key, Xero could
 * return the CACHED response for the now-DELETED timesheet — a dangling pointer.
 * So the key MUST vary per create attempt: `base + ":attempt=" + attempt`, where
 * `attempt` increments on every delete-then-recreate cycle. Within one attempt a
 * network retry reuses the same key (correct de-dupe); across cycles it differs
 * (never a stale cache hit). `attempt` is persisted on the push row.
 */

/**
 * The stable, attempt-INDEPENDENT base for a (business, staff, period). Same
 * inputs → same base forever. NOT sent to Xero directly — the durable unique row
 * is the long-window guard; this base only seeds the per-attempt key.
 */
export function baseIdempotencyKey(input: {
  businessId: string;
  staffMemberId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
}): string {
  return createHash("sha256")
    .update(
      [
        "roster:xero-timesheet:v1",
        input.businessId,
        input.staffMemberId,
        input.periodStart,
        input.periodEnd,
      ].join(":"),
    )
    .digest("hex");
}

/**
 * The actual `Idempotency-Key` sent to Xero for a create ATTEMPT. Deterministic
 * in (base, attempt): a retry of the same attempt sends the same key; a new
 * delete-then-recreate cycle (attempt+1) sends a different one. `attempt` must
 * be >= 1.
 */
export function attemptIdempotencyKey(base: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(
      `idempotency attempt must be a positive integer: ${attempt}`,
    );
  }
  return createHash("sha256")
    .update(`${base}:attempt=${attempt}`)
    .digest("hex");
}
