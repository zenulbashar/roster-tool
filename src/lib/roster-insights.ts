/**
 * Builder insights — pure, read-only maths over what's on the roster board.
 *
 * Two concerns, both FLAGS (never blocks):
 * - Overlap detection: the same person on two shifts that run at the same
 *   time on the same day (double-booked). Uses each assignment's EFFECTIVE
 *   schedule (the M30 override when set, else the shift's own times), so
 *   resizing someone's hours can create or clear an overlap. Back-to-back
 *   (one ends exactly when the next starts) is NOT an overlap.
 * - Labour-cost estimate: the week as rostered — confirmed assignments only,
 *   net worked hours (unpaid breaks out) × the rate the owner typed. An
 *   ESTIMATE, never a payroll calculation (LABOUR_COST_DISCLAIMER applies
 *   wherever it's shown); staff without a rate contribute hours but no cost
 *   and are flagged, mirroring the labour report.
 */
import { resolveSchedule, workedMinutes } from "@/lib/assignment-schedule";
import { timesOverlap } from "@/lib/shift-offer";

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
  date: string;
  /** The two shifts that clash, in board order. */
  shiftIds: [string, string];
};

/**
 * Every (person, day) where two of their visible chips (confirmed OR
 * suggested — both sit on the board) run at overlapping effective times.
 * Deterministic: pairs come out by date, then person, then input order.
 */
export function findAssignmentOverlaps(input: {
  shifts: InsightShift[];
  assignments: InsightAssignment[];
}): OverlapPair[] {
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  // (staffId, date) → that person's chips that day with effective times.
  const byPersonDay = new Map<
    string,
    Array<{ shiftId: string; start: string; end: string }>
  >();
  for (const a of input.assignments) {
    const shift = shiftById.get(a.shiftId);
    if (!shift) continue;
    const schedule = resolveSchedule(shift, a);
    const key = `${a.staffMemberId}|${shift.date}`;
    const list = byPersonDay.get(key) ?? [];
    list.push({
      shiftId: a.shiftId,
      start: schedule.startTime,
      end: schedule.endTime,
    });
    byPersonDay.set(key, list);
  }

  const pairs: OverlapPair[] = [];
  for (const [key, chips] of byPersonDay) {
    if (chips.length < 2) continue;
    const [staffMemberId = "", date = ""] = key.split("|");
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const a = chips[i]!;
        const b = chips[j]!;
        if (timesOverlap(a.start, a.end, b.start, b.end)) {
          pairs.push({ staffMemberId, date, shiftIds: [a.shiftId, b.shiftId] });
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

/** Would putting this person on `target` clash with their other chips? */
export function wouldOverlap(
  target: { startTime: string; endTime: string },
  others: Array<{ startTime: string; endTime: string }>,
): boolean {
  return others.some((o) =>
    timesOverlap(target.startTime, target.endTime, o.startTime, o.endTime),
  );
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
