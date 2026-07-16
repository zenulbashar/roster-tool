import { isoWeekday } from "@/lib/time";

/**
 * "Draft from last week" — a deterministic suggestion engine. No LLM, no
 * external calls. Given last week's confirmed assignments and this week's
 * shifts + availability, it proposes who to put on each shift.
 *
 * A shift's "type" is its template (preferred) or, if the template was deleted,
 * its label + times. We match last week to this week by shift type AND weekday,
 * so "the person who did Saturday mornings" carries over to this Saturday
 * morning — but only if they're actually available.
 */

export type ShiftLike = {
  id: string;
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
  date: string;
  /** Staffing target (M31); absent/undefined is treated as 1. */
  requiredStaff?: number;
};

export type PastAssignmentLike = {
  staffMemberId: string;
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
  date: string;
};

export type DraftSuggestion = { shiftId: string; staffMemberId: string };

export type DraftCounts = {
  totalShifts: number;
  /** Shifts that received at least one suggestion. */
  suggestedShifts: number;
  /** Shifts left blank (total minus suggested). */
  blankShifts: number;
  /** Blank shifts that had a previous person who isn't available this week. */
  blankDueToUnavailable: number;
  /**
   * Shifts still below their staffing target after drafting — nobody
   * available was left to fill them (0 when every target was met).
   */
  shortShifts?: number;
};

export type DraftResult = {
  suggestions: DraftSuggestion[];
  counts: DraftCounts;
};

/** Identifies a shift "slot": its type (template or label+times) and weekday. */
function shiftTypeKey(s: {
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
  date: string;
}): string {
  const type = s.templateId
    ? `t:${s.templateId}`
    : `l:${s.label}|${s.startTime}|${s.endTime}`;
  return `${type}|wd:${isoWeekday(s.date)}`;
}

/**
 * Build draft suggestions. `isAvailable(shiftId, staffMemberId)` must return
 * true only when that person is known to be available for that shift (their own
 * response OR a manual pre-fill). The optional `isOnLeave(shiftId,
 * staffMemberId)` excludes anyone on approved leave on that shift's day, even if
 * they're otherwise available — keeping people on leave off the draft. Pure and
 * order-stable.
 *
 * Two phases:
 * 1. LAST-WEEK: the people who did this slot (type + weekday) last week are
 *    suggested first — they keep priority, exactly the original behaviour.
 * 2. FILL-TO-TARGET (only when `staffIds` is given): shifts still below their
 *    staffing target (M31 `requiredStaff`, counting `existingAssignments` +
 *    phase-1 suggestions) are topped up from `staffIds` — ONLY people who
 *    explicitly said yes and aren't on leave, never beyond the target, spread
 *    by fewest shifts held this week (ties broken by `staffIds` order).
 */
export function buildDraft(input: {
  currentShifts: ShiftLike[];
  lastAssignments: PastAssignmentLike[];
  isAvailable: (shiftId: string, staffMemberId: string) => boolean;
  isOnLeave?: (shiftId: string, staffMemberId: string) => boolean;
  /**
   * Candidate pool for fill-to-target (active staff, in display order).
   * Absent = no top-up (the original last-week-only draft).
   */
  staffIds?: string[];
  /**
   * Assignments already in the CURRENT period (any status). They count
   * toward each shift's target, block duplicate suggestions, and seed the
   * fairness load.
   */
  existingAssignments?: Array<{ shiftId: string; staffMemberId: string }>;
}): DraftResult {
  const {
    currentShifts,
    lastAssignments,
    isAvailable,
    isOnLeave,
    staffIds,
    existingAssignments = [],
  } = input;

  // Last week's staff per shift-type+weekday slot. Insertion order preserved so
  // suggestions come out deterministically.
  const lastBySlot = new Map<string, string[]>();
  for (const a of lastAssignments) {
    const key = shiftTypeKey(a);
    const list = lastBySlot.get(key) ?? [];
    if (!list.includes(a.staffMemberId)) list.push(a.staffMemberId);
    lastBySlot.set(key, list);
  }

  // Who's already on each shift (existing rows — never re-suggested), and how
  // many shifts each person holds this week (the fairness load for top-up).
  const onShift = new Map<string, Set<string>>();
  const load = new Map<string, number>();
  for (const a of existingAssignments) {
    const set = onShift.get(a.shiftId) ?? new Set<string>();
    set.add(a.staffMemberId);
    onShift.set(a.shiftId, set);
    load.set(a.staffMemberId, (load.get(a.staffMemberId) ?? 0) + 1);
  }

  const suggestions: DraftSuggestion[] = [];
  let suggestedShifts = 0;
  let blankDueToUnavailable = 0;
  let shortShifts = 0;
  const staffOrder = new Map((staffIds ?? []).map((id, i) => [id, i]));

  for (const shift of currentShifts) {
    const already = onShift.get(shift.id) ?? new Set<string>();
    const suggestedHere = new Set<string>();
    const suggest = (staffMemberId: string) => {
      suggestions.push({ shiftId: shift.id, staffMemberId });
      suggestedHere.add(staffMemberId);
      load.set(staffMemberId, (load.get(staffMemberId) ?? 0) + 1);
    };
    const eligible = (staffId: string) =>
      !already.has(staffId) &&
      !suggestedHere.has(staffId) &&
      isAvailable(shift.id, staffId) &&
      !(isOnLeave?.(shift.id, staffId) ?? false);

    // Phase 1 — last week's crew for this slot keeps priority.
    const candidates = lastBySlot.get(shiftTypeKey(shift)) ?? [];
    for (const staffId of candidates.filter(eligible)) suggest(staffId);

    // Phase 2 — top up to the staffing target from everyone available.
    const target = shift.requiredStaff ?? 1;
    if (staffIds) {
      let needed = target - already.size - suggestedHere.size;
      if (needed > 0) {
        // Fewest shifts this week first; ties keep the caller's staff order.
        const pool = staffIds
          .filter(eligible)
          .sort(
            (a, b) =>
              (load.get(a) ?? 0) - (load.get(b) ?? 0) ||
              (staffOrder.get(a) ?? 0) - (staffOrder.get(b) ?? 0),
          );
        for (const staffId of pool) {
          if (needed <= 0) break;
          suggest(staffId);
          needed -= 1;
        }
      }
    }

    if (suggestedHere.size > 0) {
      suggestedShifts += 1;
    } else if (candidates.length > 0 && already.size === 0) {
      // Someone did this slot last week but none of them are free now (and
      // nobody else could fill it either).
      blankDueToUnavailable += 1;
    }
    if (already.size + suggestedHere.size < target) shortShifts += 1;
  }

  const totalShifts = currentShifts.length;
  return {
    suggestions,
    counts: {
      totalShifts,
      suggestedShifts,
      blankShifts: totalShifts - suggestedShifts,
      blankDueToUnavailable,
      shortShifts,
    },
  };
}

/** One-line, plain-English summary built only from the algorithm's counts. */
export function draftSummary(counts: DraftCounts): string {
  const { totalShifts, suggestedShifts, blankDueToUnavailable, shortShifts } =
    counts;
  const shiftWord = (n: number) => (n === 1 ? "shift" : "shifts");

  let msg = `Suggested ${suggestedShifts} of ${totalShifts} ${shiftWord(totalShifts)} based on last week and availability.`;
  if (blankDueToUnavailable > 0) {
    msg += ` ${blankDueToUnavailable} ${shiftWord(blankDueToUnavailable)} left blank — those staff aren't available this week.`;
  }
  if (shortShifts && shortShifts > 0) {
    msg += ` ${shortShifts} ${shiftWord(shortShifts)} still below the staff target — no one else said they're available.`;
  }
  return msg;
}
