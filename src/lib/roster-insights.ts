/**
 * Builder insights — pure, read-only maths over what's on the roster board.
 *
 * Two concerns, both FLAGS (never blocks):
 * - Overlap detection: the same person on two shifts that run at the same
 *   time (double-booked). Uses each assignment's EFFECTIVE schedule (the M30
 *   override when set, else the shift's own times), so resizing someone's
 *   hours can create or clear an overlap. Compared on ABSOLUTE time (date +
 *   extended minutes, M34), so a Friday overnight close clashes with a
 *   too-early Saturday morning shift. Back-to-back (one ends exactly when
 *   the next starts) is NOT an overlap.
 * - Labour-cost estimate: the week as rostered — confirmed assignments only,
 *   net worked hours (unpaid breaks out) × the rate the owner typed. An
 *   ESTIMATE, never a payroll calculation (LABOUR_COST_DISCLAIMER applies
 *   wherever it's shown); staff without a rate contribute hours but no cost
 *   and are flagged, mirroring the labour report.
 */
import {
  DAY_MINUTES,
  extendedRange,
  resolveSchedule,
  workedMinutes,
} from "@/lib/assignment-schedule";

export type InsightShift = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type InsightAssignment = {
  shiftId: string;
  staffMemberId: string;
  status: "confirmed" | "suggested";
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  breakStart: string | null;
};

export type OverlapPair = {
  staffMemberId: string;
  /** The date of the earlier of the two chips (for display). */
  date: string;
  /** The two shifts that clash, earlier first. */
  shiftIds: [string, string];
};

/** Days since epoch for a "YYYY-MM-DD" date (UTC-safe). */
function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/**
 * Every pair of one person's visible chips (confirmed OR suggested — both
 * sit on the board) that run at overlapping effective times, compared on
 * absolute time so overnight shifts clash across the date line too.
 * Deterministic: pairs come out by date, then person.
 */
export function findAssignmentOverlaps(input: {
  shifts: InsightShift[];
  assignments: InsightAssignment[];
}): OverlapPair[] {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  // staffId → that person's chips as absolute [start, end) minute ranges.
  const byPerson = new Map<
    string,
    Array<{ shiftId: string; date: string; start: number; end: number }>
  >();
  for (const a of input.assignments) {
    const shift = shiftById.get(a.shiftId);
    if (!shift) continue;
    const schedule = resolveSchedule(shift, a);
    const range = extendedRange(schedule.startTime, schedule.endTime);
    const base = dayNumber(shift.date) * DAY_MINUTES;
    const list = byPerson.get(a.staffMemberId) ?? [];
    list.push({
      shiftId: a.shiftId,
      date: shift.date,
      start: base + range.start,
      end: base + range.end,
    });
    byPerson.set(a.staffMemberId, list);
  }

  const pairs: OverlapPair[] = [];
  for (const [staffMemberId, chips] of byPerson) {
    if (chips.length < 2) continue;
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const [a, b] =
          chips[i]!.start <= chips[j]!.start
            ? [chips[i]!, chips[j]!]
            : [chips[j]!, chips[i]!];
        if (a.start < b.end && b.start < a.end) {
          pairs.push({
            staffMemberId,
            date: a.date,
            shiftIds: [a.shiftId, b.shiftId],
          });
        }
      }
    }
  }
  return pairs.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.staffMemberId.localeCompare(b.staffMemberId),
  );
}

/**
 * Would putting this person on `target` clash with their other chips? All
 * ranges anchored to the same day, overnight-aware (the drop-preview hint;
 * cross-day clashes surface via findAssignmentOverlaps after the drop).
 */
export function wouldOverlap(
  target: { startTime: string; endTime: string },
  others: Array<{ startTime: string; endTime: string }>,
): boolean {
  const t = extendedRange(target.startTime, target.endTime);
  return others.some((o) => {
    const r = extendedRange(o.startTime, o.endTime);
    return t.start < r.end && r.start < t.end;
  });
}

export type RosterCostEstimate = {
  /** Net rostered minutes across confirmed assignments (breaks out). */
  totalMinutes: number;
  /** Estimated cost in cents for the RATED portion of those minutes. */
  costCents: number;
  /** Minutes worked by staff with no rate set (never costed as $0). */
  unratedMinutes: number;
  /** Names of assigned staff with no rate, deduped, in staff order. */
  unratedStaffNames: string[];
  /** Confirmed assignments counted. */
  assignmentCount: number;
};

/**
 * The week's labour cost as ROSTERED: confirmed assignments only (a
 * suggestion isn't a commitment), each at its effective schedule net of the
 * unpaid break, hours rounded to 2dp per assignment before costing —
 * mirroring the labour report/CSV maths so the numbers agree in spirit.
 */
export function estimateRosterCost(input: {
  shifts: InsightShift[];
  assignments: InsightAssignment[];
  staff: Array<{ id: string; name: string; payRateCents: number | null }>;
}): RosterCostEstimate {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const staffById = new Map(input.staff.map((m) => [m.id, m]));
  let totalMinutes = 0;
  let costCents = 0;
  let unratedMinutes = 0;
  let assignmentCount = 0;
  const unrated = new Set<string>();

  for (const a of input.assignments) {
    if (a.status !== "confirmed") continue;
    const shift = shiftById.get(a.shiftId);
    const member = staffById.get(a.staffMemberId);
    if (!shift || !member) continue;
    const minutes = workedMinutes(resolveSchedule(shift, a));
    if (minutes <= 0) continue;
    assignmentCount += 1;
    totalMinutes += minutes;
    const hours = Math.round((minutes / 60) * 100) / 100;
    if (member.payRateCents != null) {
      costCents += Math.round(hours * member.payRateCents);
    } else {
      unratedMinutes += minutes;
      unrated.add(member.id);
    }
  }

  return {
    totalMinutes,
    costCents,
    unratedMinutes,
    unratedStaffNames: input.staff
      .filter((m) => unrated.has(m.id))
      .map((m) => m.name),
    assignmentCount,
  };
}
