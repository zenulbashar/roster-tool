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
};

export type PastAssignmentLike = {
  staffMemberId: string;
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
  date: string;
  /** The person's own schedule override last week (null = the shift's times).
   * Carried into the suggestion so a shaped shift (custom span + break)
   * reproduces, not just the slot. */
  assignmentStartTime?: string | null;
  assignmentEndTime?: string | null;
  assignmentBreakMinutes?: number | null;
};

export type DraftSuggestion = {
  shiftId: string;
  staffMemberId: string;
  startTime?: string | null;
  endTime?: string | null;
  breakMinutes?: number;
};

export type DraftCounts = {
  totalShifts: number;
  /** Shifts that received at least one suggestion. */
  suggestedShifts: number;
  /** Shifts left blank (total minus suggested). */
  blankShifts: number;
  /** Blank shifts that had a previous person who isn't available this week. */
  blankDueToUnavailable: number;
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
 */
export function buildDraft(input: {
  currentShifts: ShiftLike[];
  lastAssignments: PastAssignmentLike[];
  isAvailable: (shiftId: string, staffMemberId: string) => boolean;
  isOnLeave?: (shiftId: string, staffMemberId: string) => boolean;
}): DraftResult {
  const { currentShifts, lastAssignments, isAvailable, isOnLeave } = input;

  // Last week's staff (with their own schedule, if any) per shift-type+weekday
  // slot. Insertion order preserved so suggestions come out deterministically.
  type Candidate = {
    staffMemberId: string;
    startTime: string | null;
    endTime: string | null;
    breakMinutes: number;
  };
  const lastBySlot = new Map<string, Candidate[]>();
  for (const a of lastAssignments) {
    const key = shiftTypeKey(a);
    const list = lastBySlot.get(key) ?? [];
    if (!list.some((c) => c.staffMemberId === a.staffMemberId)) {
      list.push({
        staffMemberId: a.staffMemberId,
        startTime: a.assignmentStartTime ?? null,
        endTime: a.assignmentEndTime ?? null,
        breakMinutes: a.assignmentBreakMinutes ?? 0,
      });
    }
    lastBySlot.set(key, list);
  }

  const suggestions: DraftSuggestion[] = [];
  let suggestedShifts = 0;
  let blankDueToUnavailable = 0;

  for (const shift of currentShifts) {
    const candidates = lastBySlot.get(shiftTypeKey(shift)) ?? [];
    const available = candidates.filter(
      (c) =>
        isAvailable(shift.id, c.staffMemberId) &&
        !(isOnLeave?.(shift.id, c.staffMemberId) ?? false),
    );

    if (available.length > 0) {
      suggestedShifts += 1;
      for (const c of available) {
        suggestions.push({
          shiftId: shift.id,
          staffMemberId: c.staffMemberId,
          startTime: c.startTime,
          endTime: c.endTime,
          breakMinutes: c.breakMinutes,
        });
      }
    } else if (candidates.length > 0) {
      // Someone did this slot last week but none of them are free now.
      blankDueToUnavailable += 1;
    }
  }

  const totalShifts = currentShifts.length;
  return {
    suggestions,
    counts: {
      totalShifts,
      suggestedShifts,
      blankShifts: totalShifts - suggestedShifts,
      blankDueToUnavailable,
    },
  };
}

/** One-line, plain-English summary built only from the algorithm's counts. */
export function draftSummary(counts: DraftCounts): string {
  const { totalShifts, suggestedShifts, blankDueToUnavailable } = counts;
  const shiftWord = (n: number) => (n === 1 ? "shift" : "shifts");

  let msg = `Suggested ${suggestedShifts} of ${totalShifts} ${shiftWord(totalShifts)} based on last week.`;
  if (blankDueToUnavailable > 0) {
    msg += ` ${blankDueToUnavailable} ${shiftWord(blankDueToUnavailable)} left blank — those staff aren't available this week.`;
  }
  return msg;
}
