import { createHash } from "node:crypto";
import type { TenantRepo } from "@/lib/tenant/repository";
import type { XeroClient } from "./client";
import { XeroApiError, XeroTimesheetAlreadyActioned } from "./errors";
import { attemptIdempotencyKey, baseIdempotencyKey } from "./idempotency";
import { classifyEntries, type ActivePayRule } from "./pay-rules";
import type { PushEntry } from "./timesheet-lines";

/**
 * Push orchestration (#16): turn APPROVED, closed hours into a DRAFT Xero
 * timesheet for one mapped employee over one Xero-sourced pay period, and cancel
 * one. Everything lands as `Draft`; a human approves + runs pay in Xero.
 *
 * Re-push on Payroll 2.0 is DELETE-then-CREATE (no update verb). The row obeys
 * one INVARIANT: `xero_timesheet_id` is non-null ⟺ a live Draft exists in Xero.
 * The instant a delete succeeds we persist `id = NULL` (+ the incremented
 * `attempt`) BEFORE the recreate, so a create failure — or a crash — leaves the
 * row in the DISTINCT "no draft currently exists" state, never a pointer to a
 * deleted timesheet. The Idempotency-Key VARIES per attempt so a replay after a
 * delete can't return Xero's cached response for the now-deleted draft.
 */

export type PushOutcome =
  | { status: "pushed"; xeroTimesheetId: string; hoursTotal: number }
  | { status: "unchanged"; xeroTimesheetId: string }
  | { status: "skipped"; reason: "no_hours" }
  | { status: "blocked"; reason: "no_rate" | "already_actioned" }
  | { status: "failed"; reason: "no_draft_exists" | "delete_failed" };

/** Stable content hash — lets a re-push with unchanged hours be a no-op. Each
 * line's pay item is part of the content, so an owner editing a pay rule
 * changes the hash and the next push replaces the draft (delete-then-create). */
export function hashPushPayload(input: {
  xeroEmployeeId: string;
  earningsRateId: string;
  periodStart: string;
  periodEnd: string;
  lines: Array<{ date: string; numberOfUnits: number; earningsRateId: string }>;
}): string {
  const canonical = JSON.stringify({
    e: input.xeroEmployeeId,
    r: input.earningsRateId,
    s: input.periodStart,
    d: input.periodEnd,
    l: input.lines.map((l) => [l.date, l.earningsRateId, l.numberOfUnits]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Push ONE mapped employee's approved hours as a DRAFT timesheet for one period.
 * `entries` are this employee's APPROVED, closed entries (they may reach back
 * to the Monday of the week containing `periodStart` purely as cumulation
 * context for weekly rules); `periodStart/End` come straight from the Xero pay
 * calendar (no local period math). `rules` are the owner's ACTIVE, parsed pay
 * rules (`toActivePayRules`); with none, every line carries the ordinary rate —
 * identical to the pre-rules behaviour.
 */
export async function pushEmployeeTimesheet(opts: {
  repo: TenantRepo;
  client: XeroClient;
  accessToken: string;
  tenantId: string;
  businessId: string;
  timezone: string;
  staffMemberId: string;
  xeroEmployeeId: string;
  earningsRateId: string | null;
  payrollCalendarId: string;
  periodStart: string;
  periodEnd: string;
  entries: PushEntry[];
  rules?: ActivePayRule[];
  now?: Date;
}): Promise<PushOutcome> {
  const {
    repo,
    client,
    accessToken,
    tenantId,
    businessId,
    timezone,
    staffMemberId,
    xeroEmployeeId,
    earningsRateId,
    payrollCalendarId,
    periodStart,
    periodEnd,
    entries,
    rules = [],
    now = new Date(),
  } = opts;

  // Gate: an unresolved earnings rate blocks push (never a silent guess).
  if (!earningsRateId) return { status: "blocked", reason: "no_rate" };

  const classified = classifyEntries({
    entries,
    rules,
    ordinaryEarningsRateId: earningsRateId,
    timezone,
    periodStart,
    periodEnd,
  });
  const { totalHours } = classified;
  const lines = classified.lines.map((l) => ({
    date: l.date,
    numberOfUnits: l.numberOfUnits,
    earningsRateId: l.earningsRateId,
  }));
  if (lines.length === 0) return { status: "skipped", reason: "no_hours" };

  const payloadHash = hashPushPayload({
    xeroEmployeeId,
    earningsRateId,
    periodStart,
    periodEnd,
    lines,
  });
  const base = baseIdempotencyKey({
    businessId,
    staffMemberId,
    periodStart,
    periodEnd,
  });
  const input = {
    payrollCalendarId,
    employeeId: xeroEmployeeId,
    startDate: periodStart,
    endDate: periodEnd,
    earningsRateId,
    lines,
  };

  const existing = await repo.getXeroPush(
    staffMemberId,
    periodStart,
    periodEnd,
  );
  const hasLiveDraft = Boolean(
    existing && existing.status === "draft" && existing.xeroTimesheetId,
  );

  // Unchanged re-push → no-op (don't delete+recreate for identical hours).
  if (hasLiveDraft && existing!.payloadHash === payloadHash) {
    return { status: "unchanged", xeroTimesheetId: existing!.xeroTimesheetId! };
  }

  const attempt = (existing?.attempt ?? 0) + 1;
  const key = attemptIdempotencyKey(base, attempt);
  let preMarked = false;

  // If a live draft exists, verify it's still Draft, then delete it. The moment
  // the delete succeeds we persist "no live draft" (id=NULL + bumped attempt)
  // BEFORE the recreate — that is the gap the invariant protects.
  if (hasLiveDraft) {
    let current = null as Awaited<
      ReturnType<XeroClient["getTimesheet"]>
    > | null;
    try {
      current = await client.getTimesheet(
        accessToken,
        tenantId,
        existing!.xeroTimesheetId!,
      );
    } catch (err) {
      // 404 = the draft was deleted in Xero externally → treat as gone.
      if (!(err instanceof XeroApiError && err.status === 404)) throw err;
    }
    if (current) {
      if (current.status !== "Draft") {
        return { status: "blocked", reason: "already_actioned" };
      }
      try {
        await client.deleteTimesheet(
          accessToken,
          tenantId,
          existing!.xeroTimesheetId!,
        );
      } catch {
        // Delete failed → the OLD draft is still live and the row is unchanged.
        // Not the "no draft" state; surface a distinct failure.
        return { status: "failed", reason: "delete_failed" };
      }
    }
    // Deleted (or externally gone): persist id=NULL + bumped attempt now.
    await repo.markXeroPushNoDraft({
      staffMemberId,
      xeroEmployeeId,
      periodStart,
      periodEnd,
      hoursTotal: totalHours,
      payloadHash,
      idempotencyKey: key,
      attempt,
      now,
    });
    preMarked = true;
  }

  // Create the (new) draft with the per-attempt key.
  try {
    const created = await client.createDraftTimesheet(
      accessToken,
      tenantId,
      input,
      key,
    );
    await repo.saveXeroPushDraft({
      staffMemberId,
      xeroEmployeeId,
      periodStart,
      periodEnd,
      xeroTimesheetId: created.timesheetId,
      hoursTotal: totalHours,
      payloadHash,
      idempotencyKey: key,
      attempt,
      now,
    });
    return {
      status: "pushed",
      xeroTimesheetId: created.timesheetId,
      hoursTotal: totalHours,
    };
  } catch {
    // Create failed. If we deleted first, the pre-marker already recorded the
    // distinct "no draft exists" state; for a first push, record it now.
    if (!preMarked) {
      await repo.markXeroPushNoDraft({
        staffMemberId,
        xeroEmployeeId,
        periodStart,
        periodEnd,
        hoursTotal: totalHours,
        payloadHash,
        idempotencyKey: key,
        attempt,
        now,
      });
    }
    return { status: "failed", reason: "no_draft_exists" };
  }
}

export type CancelOutcome = { status: "cancelled" } | { status: "not_found" };

/**
 * Cancel a pushed draft: guard it's still `Draft` in Xero (else throw
 * `XeroTimesheetAlreadyActioned` — a human has actioned it), delete it, and mark
 * the row `cancelled` with `xero_timesheet_id = NULL`. A 404 (already gone) is
 * treated as success.
 */
export async function cancelPush(opts: {
  repo: TenantRepo;
  client: XeroClient;
  accessToken: string;
  tenantId: string;
  pushId: string;
  now?: Date;
}): Promise<CancelOutcome> {
  const {
    repo,
    client,
    accessToken,
    tenantId,
    pushId,
    now = new Date(),
  } = opts;
  const push = await repo.getXeroPushById(pushId);
  if (!push) return { status: "not_found" };

  if (push.status === "draft" && push.xeroTimesheetId) {
    let current = null as Awaited<
      ReturnType<XeroClient["getTimesheet"]>
    > | null;
    try {
      current = await client.getTimesheet(
        accessToken,
        tenantId,
        push.xeroTimesheetId,
      );
    } catch (err) {
      if (!(err instanceof XeroApiError && err.status === 404)) throw err;
    }
    if (current && current.status !== "Draft") {
      throw new XeroTimesheetAlreadyActioned();
    }
    if (current) {
      await client.deleteTimesheet(accessToken, tenantId, push.xeroTimesheetId);
    }
  }

  await repo.markXeroPushCancelled(push.id, now);
  return { status: "cancelled" };
}
