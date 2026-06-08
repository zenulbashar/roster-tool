import type { TimeOnly } from "@/lib/time";

/**
 * Pure shift-offer logic: status transitions and claim eligibility/conflict
 * checks. No DB, no side effects — the repository calls these to decide whether
 * a release/claim/approve/deny/withdraw is allowed before touching any rows.
 *
 * Model: release → claim → owner approves (one-directional, owner-approved,
 * published-roster shifts only). No bilateral A↔B swaps, no auto-approval.
 */

export type OfferStatus =
  | "open"
  | "claimed"
  | "approved"
  | "denied"
  | "withdrawn";

/** Statuses that occupy a shift — at most one active offer per shift. */
export const ACTIVE_OFFER_STATUSES: readonly OfferStatus[] = ["open", "claimed"];

export function isActiveOfferStatus(status: OfferStatus): boolean {
  return ACTIVE_OFFER_STATUSES.includes(status);
}

export type OfferAction = "claim" | "approve" | "deny" | "withdraw";

/**
 * The status an offer moves to for a given action, or null if the action isn't
 * allowed from the current status. The only valid transitions are:
 *   open    + claim    → claimed
 *   claimed + approve  → approved
 *   claimed + deny     → denied
 *   open    + withdraw → withdrawn
 * Everything else (acting on an already-decided offer, approving an unclaimed
 * offer, etc.) returns null.
 */
export function offerTransition(
  current: OfferStatus,
  action: OfferAction,
): OfferStatus | null {
  if (current === "open" && action === "claim") return "claimed";
  if (current === "claimed" && action === "approve") return "approved";
  if (current === "claimed" && action === "deny") return "denied";
  if (current === "open" && action === "withdraw") return "withdrawn";
  return null;
}

/**
 * Whether a wall-clock time range [aStart, aEnd) overlaps [bStart, bEnd).
 * Times are "HH:MM" or "HH:MM:SS" strings, which sort lexically, so a plain
 * string compare is a correct time compare. Touching ends (one ends exactly
 * when the other starts) do NOT count as overlapping.
 */
export function timesOverlap(
  aStart: TimeOnly,
  aEnd: TimeOnly,
  bStart: TimeOnly,
  bEnd: TimeOnly,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type ClaimEligibility = { ok: true } | { ok: false; reason: string };

/**
 * Can this staff member claim this offer? Hard blocks only (not the soft
 * leave/overlap conflict flags, which never block). The claimer can't take an
 * offer that isn't open, claim a shift they themselves released, or claim a
 * shift they're already assigned to.
 */
export function claimEligibility(input: {
  offerStatus: OfferStatus;
  offeredByStaffId: string | null;
  claimerStaffId: string;
  alreadyAssignedToShift: boolean;
}): ClaimEligibility {
  if (input.offerStatus !== "open") {
    return { ok: false, reason: "This shift isn't available to claim anymore." };
  }
  if (input.offeredByStaffId === input.claimerStaffId) {
    return { ok: false, reason: "You can't claim a shift you offered up." };
  }
  if (input.alreadyAssignedToShift) {
    return { ok: false, reason: "You're already on this shift." };
  }
  return { ok: true };
}
