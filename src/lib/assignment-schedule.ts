/**
 * Per-assignment schedule maths for the drag-and-drop roster builder. Pure —
 * no I/O, no dates, no timezone: everything works on "HH:MM" wall-clock
 * strings and minutes-since-midnight, matching how shifts store their times.
 *
 * The model: a `shift` block keeps its own snapshot times (the slot the owner
 * planned); a `roster_assignment` may carry an OVERRIDE (start/end) meaning
 * "this person works different hours on this shift", plus an unpaid break
 * (length + where it sits) drawn as a gap in the person's bar. Null override =
 * the person works the shift's own times — the original behaviour, so every
 * pre-existing assignment renders exactly as before.
 *
 * OVERNIGHT (M34): a shift stays anchored to the date it STARTS; an end time
 * at or before the start means it finishes the NEXT day ("Friday close" =
 * Fri 18:00 – Sat 02:00 lives on Friday). All maths run on an EXTENDED axis:
 * minutes may exceed 1440 (end 02:00 after start 18:00 = minute 1560), and
 * wall-clock fields store the mod-1440 "HH:MM". Same-day shifts behave
 * exactly as before.
 */

/** Break lengths the owner can drop into a shift: none, 30 min, or 1 hour. */
export const ASSIGNMENT_BREAK_OPTIONS = [0, 30, 60] as const;

/** Drag/resize snap step for the schedule editor, in minutes. */
export const SNAP_STEP = 15;

export const DAY_MINUTES = 1440;

export type ShiftTimesLike = { startTime: string; endTime: string };

export type AssignmentScheduleLike = {
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  breakStart: string | null;
};

/** A person's effective schedule on a shift, always normalised to "HH:MM". */
export type EffectiveSchedule = {
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakStart: string | null;
  /** True when the times differ from the shift block's own (an override). */
  overridden: boolean;
};

/** "9:5", "09:05:00" → "09:05". Postgres `time` comes back as HH:MM:SS. */
export function normalizeTime(t: string): string {
  const [h = "0", m = "0"] = t.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** "HH:MM[:SS]" → minutes since midnight. Invalid input → NaN. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m))
    return NaN;
  return h * 60 + m;
}

/** Minutes since midnight → "HH:MM". Clamped to the day. */
export function minutesToTime(mins: number): string {
  const m = Math.min(Math.max(Math.round(mins), 0), DAY_MINUTES - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Snap minutes to the editor's step (nearest). */
export function snapMinutes(mins: number, step: number = SNAP_STEP): number {
  return Math.round(mins / step) * step;
}

/** Does this range run past midnight? (end at/before start = next day). */
export function isOvernight(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) <= timeToMinutes(startTime);
}

/**
 * Length of a shift range in minutes, overnight-aware: end after start is a
 * same-day span; end at/before start wraps to the next day (18:00 – 02:00 =
 * 480). Equal times yield a degenerate 0 (rejected by validateSchedule).
 */
export function spanMinutes(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return NaN;
  if (end === start) return 0;
  return end > start ? end - start : end + DAY_MINUTES - start;
}

/**
 * A schedule's [start, end) on the extended axis: start is minutes since the
 * anchor day's midnight (< 1440), end may exceed 1440 for overnight ranges.
 */
export function extendedRange(
  startTime: string,
  endTime: string,
): { start: number; end: number } {
  const start = timeToMinutes(startTime);
  return { start, end: start + spanMinutes(startTime, endTime) };
}

/**
 * A break's start on the extended axis: a wall-clock at/after the shift's
 * start is the same day; an earlier one (e.g. 01:00 in an 18:00 – 04:00
 * shift) is after midnight, so it shifts up a day.
 */
export function extendedBreakStart(
  breakStart: string,
  shiftStartTime: string,
): number {
  const b = timeToMinutes(breakStart);
  return b >= timeToMinutes(shiftStartTime) ? b : b + DAY_MINUTES;
}

/**
 * The schedule a person actually works on a shift: the assignment's override
 * when set, else the shift's own times. Break fields ride along unchanged.
 */
export function resolveSchedule(
  shift: ShiftTimesLike,
  assignment?: Partial<AssignmentScheduleLike> | null,
): EffectiveSchedule {
  const overridden = Boolean(assignment?.startTime && assignment?.endTime);
  const startTime = normalizeTime(
    overridden ? assignment!.startTime! : shift.startTime,
  );
  const endTime = normalizeTime(
    overridden ? assignment!.endTime! : shift.endTime,
  );
  const breakMinutes = assignment?.breakMinutes ?? 0;
  const breakStart =
    breakMinutes > 0 && assignment?.breakStart
      ? normalizeTime(assignment.breakStart)
      : null;
  return { startTime, endTime, breakMinutes, breakStart, overridden };
}

/** Net worked minutes: span minus the unpaid break, clamped at zero. */
export function workedMinutes(s: {
  startTime: string;
  endTime: string;
  breakMinutes: number;
}): number {
  return Math.max(spanMinutes(s.startTime, s.endTime) - s.breakMinutes, 0);
}

/** "7h 30m" / "12h" / "45m" — compact duration for chips and the editor. */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * The worked segments of a schedule on the EXTENDED axis — one segment, or
 * two around the break gap; overnight segments run past minute 1440 (the day
 * bar wraps them, the editor's axis shows them directly). A break that
 * doesn't fully fit inside the span is intersected with it; a
 * degenerate/missing break yields a single segment.
 */
export function scheduleSegments(s: {
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakStart: string | null;
}): Array<{ start: number; end: number }> {
  const { start, end } = extendedRange(s.startTime, s.endTime);
  if (!(end > start)) return [];
  if (s.breakMinutes <= 0 || !s.breakStart) return [{ start, end }];
  const bStart = Math.max(extendedBreakStart(s.breakStart, s.startTime), start);
  const bEnd = Math.min(bStart + s.breakMinutes, end);
  if (!(bEnd > bStart)) return [{ start, end }];
  const segments: Array<{ start: number; end: number }> = [];
  if (bStart > start) segments.push({ start, end: bStart });
  if (end > bEnd) segments.push({ start: bEnd, end });
  return segments.length > 0 ? segments : [{ start, end }];
}

/**
 * Where a freshly-added break should sit: centred in the span, snapped to the
 * editor step, clamped so the whole break fits inside [start, end].
 */
export function defaultBreakStart(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): string {
  const { start, end } = extendedRange(startTime, endTime);
  const centred = snapMinutes(start + (end - start - breakMinutes) / 2);
  const clamped = Math.min(Math.max(centred, start), end - breakMinutes);
  return minutesToTime(clamped % DAY_MINUTES);
}

export type ScheduleValidation = { ok: true } | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate a schedule override the owner is saving. Times must be same-day
 * (start < end, ≥ 15 min), the break one of the allowed lengths, and the
 * whole break must sit inside the worked span. Pure — server actions wrap
 * this after zod shape-checks the raw input.
 */
export function validateSchedule(s: {
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakStart: string | null;
}): ScheduleValidation {
  if (!HHMM.test(s.startTime) || !HHMM.test(s.endTime))
    return { ok: false, error: "Use times like 09:00." };
  const span = spanMinutes(s.startTime, s.endTime);
  if (span < 15)
    return {
      ok: false,
      error: "The shift must run for at least 15 minutes.",
    };
  if (!(ASSIGNMENT_BREAK_OPTIONS as readonly number[]).includes(s.breakMinutes))
    return { ok: false, error: "Pick a break of none, 30 minutes, or 1 hour." };
  if (s.breakMinutes === 0) {
    if (s.breakStart !== null)
      return { ok: false, error: "A break needs a length." };
    return { ok: true };
  }
  if (s.breakStart === null || !HHMM.test(s.breakStart))
    return { ok: false, error: "Choose where the break starts." };
  const { start, end } = extendedRange(s.startTime, s.endTime);
  const bStart = extendedBreakStart(s.breakStart, s.startTime);
  if (bStart < start || bStart + s.breakMinutes > end)
    return {
      ok: false,
      error: "The break must fit inside the shift times.",
    };
  return { ok: true };
}

/** Do two shift blocks run at the same base times? (HH:MM-normalised.) */
export function sameShiftTimes(a: ShiftTimesLike, b: ShiftTimesLike): boolean {
  return (
    normalizeTime(a.startTime) === normalizeTime(b.startTime) &&
    normalizeTime(a.endTime) === normalizeTime(b.endTime)
  );
}

/**
 * What schedule an assignment keeps when it MOVES to another shift. The
 * override + break travel with the person only when the target block runs the
 * same base times (e.g. the same shift type on another day) — otherwise stale
 * times would silently misstate their hours, so the schedule resets to the
 * target shift's own times, keeping the break if it still fits.
 */
export function carrySchedule(
  assignment: AssignmentScheduleLike,
  sourceShift: ShiftTimesLike,
  targetShift: ShiftTimesLike,
): AssignmentScheduleLike {
  if (sameShiftTimes(sourceShift, targetShift)) {
    return {
      startTime: assignment.startTime
        ? normalizeTime(assignment.startTime)
        : null,
      endTime: assignment.endTime ? normalizeTime(assignment.endTime) : null,
      breakMinutes: assignment.breakMinutes,
      breakStart: assignment.breakStart
        ? normalizeTime(assignment.breakStart)
        : null,
    };
  }
  // Different base times: drop the override; keep the break only if it still
  // fits inside the target's own span.
  const cleared: AssignmentScheduleLike = {
    startTime: null,
    endTime: null,
    breakMinutes: 0,
    breakStart: null,
  };
  if (assignment.breakMinutes > 0 && assignment.breakStart) {
    const check = validateSchedule({
      startTime: normalizeTime(targetShift.startTime),
      endTime: normalizeTime(targetShift.endTime),
      breakMinutes: assignment.breakMinutes,
      breakStart: normalizeTime(assignment.breakStart),
    });
    if (check.ok) {
      return {
        ...cleared,
        breakMinutes: assignment.breakMinutes,
        breakStart: normalizeTime(assignment.breakStart),
      };
    }
  }
  return cleared;
}

export type ShiftBlockLike = ShiftTimesLike & {
  id: string;
  templateId: string | null;
  label: string;
  date: string;
};

/**
 * Resolve where a chip dropped on a (staff, date) cell should land: the shift
 * on the target date that matches the source shift's TYPE — same template id
 * (survives renames), else same label + times (survives template deletion).
 * Null = no matching block; the caller clones the source shift onto the date.
 */
export function findMatchingShiftOnDate(
  shifts: ShiftBlockLike[],
  source: ShiftBlockLike,
  targetDate: string,
): ShiftBlockLike | null {
  const onDate = shifts.filter(
    (s) => s.date === targetDate && s.id !== source.id,
  );
  if (source.templateId) {
    const byTemplate = onDate.find((s) => s.templateId === source.templateId);
    if (byTemplate) return byTemplate;
  }
  return (
    onDate.find((s) => s.label === source.label && sameShiftTimes(s, source)) ??
    null
  );
}
