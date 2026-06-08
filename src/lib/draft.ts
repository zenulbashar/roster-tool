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
 * response OR a manual pre-fill). Pure and order-stable.
 */
export function buildDraft(input: {
  currentShifts: ShiftLike[];
  lastAssignments: PastAssignmentLike[];
  isAvailable: (shiftId: string, staffMemberId: string) => boolean;
}): DraftResult {
  const { currentShifts, lastAssignments, isAvailable } = input;

  // Last week's staff per shift-type+weekday slot. Insertion order preserved so
  // suggestions come out deterministically.
  const lastBySlot = new Map<string, string[]>();
  for (const a of lastAssignments) {
    const key = shiftTypeKey(a);
    const list = lastBySlot.get(key) ?? [];
    if (!list.includes(a.staffMemberId)) list.push(a.staffMemberId);
    lastBySlot.set(key, list);
  }

  const suggestions: DraftSuggestion[] = [];
  let suggestedShifts = 0;
  let blankDueToUnavailable = 0;

  for (const shift of currentShifts) {
    const candidates = lastBySlot.get(shiftTypeKey(shift)) ?? [];
    const available = candidates.filter((staffId) =>
      isAvailable(shift.id, staffId),
    );

    if (available.length > 0) {
      suggestedShifts += 1;
      for (const staffMemberId of available) {
        suggestions.push({ shiftId: shift.id, staffMemberId });
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
