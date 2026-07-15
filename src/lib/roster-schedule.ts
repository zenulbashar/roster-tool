/**
 * Per-assignment schedule maths for the drag-drop timeline roster builder.
 *
 * A `shift` carries nominal wall-clock times shared by everyone on it. An
 * assignment MAY override those with its own `startTime`/`endTime` (so two
 * people on the same shift can work different spans) plus an unpaid
 * `breakMinutes` the owner drops in. This module is the single, PURE source of
 * truth for resolving those, sizing the coloured block, and clamping/validating
 * edits — so the grid, the timeline editor and any tests all agree.
 *
 * IMPORTANT: rostered times + breaks are PLANNING AIDS only. They are never a
 * payroll calculation and are never enforced against clock-in; paid hours come
 * from `timesheet_entry` (actual clocked time), unchanged.
 */

export type ClockTime = string; // "HH:MM" or "HH:MM:SS"

/** Minutes in a day. A block may end exactly at 24:00 (end of day). */
export const DAY_MINUTES = 24 * 60;
/** Resize/drag granularity, in minutes. */
export const SNAP_MINUTES = 15;
/** Shortest block the editor allows (guards against zero/negative spans). */
export const MIN_SHIFT_MINUTES = 30;
/** Break lengths the owner can drop into a block (minutes). */
export const BREAK_OPTIONS = [0, 30, 60] as const;

/** Parse "HH:MM" / "HH:MM:SS" (and the end-of-day "24:00") to minutes. */
export function timeToMinutes(t: ClockTime): number {
  const [h = "0", m = "0"] = (t ?? "").split(":");
  const hours = Number(h);
  const mins = Number(m);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return 0;
  return hours * 60 + mins;
}

/**
 * Minutes → "HH:MM". 1440 renders as "24:00" (a valid Postgres `time` meaning
 * end of day). Clamped to [0, 1440]; never wraps.
 */
export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Round a minute value to the nearest `step` (default 15), clamped to a day. */
export function snapMinutes(min: number, step: number = SNAP_MINUTES): number {
  const snapped = Math.round(min / step) * step;
  return Math.max(0, Math.min(DAY_MINUTES, snapped));
}

export type ShiftLike = { startTime: ClockTime; endTime: ClockTime };
export type AssignmentScheduleLike = {
  startTime?: ClockTime | null;
  endTime?: ClockTime | null;
  breakMinutes?: number | null;
};

export type ResolvedSchedule = {
  /** "HH:MM" resolved start (assignment override, else the shift's). */
  start: string;
  /** "HH:MM" resolved end. */
  end: string;
  /** Unpaid break in minutes, clamped to the block span. */
  breakMinutes: number;
  /** Gross span in minutes (handles a shift that crosses midnight). */
  spanMinutes: number;
  /** Net worked minutes = span − break (never below 0). */
  netMinutes: number;
  /** True when this assignment carries its own times or a break. */
  custom: boolean;
};

/**
 * Gross span between two wall-clock times, in minutes. If `end` is not after
 * `start` the block is treated as crossing midnight (+24h), so a 22:00→02:00
 * close shift is 240 min. An end of exactly 24:00 is a normal same-day end.
 */
export function spanMinutes(start: ClockTime, end: ClockTime): number {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return e > s ? e - s : e + DAY_MINUTES - s;
}

/** Clamp a break to [0, span] so it can never exceed the block. */
export function clampBreakMinutes(breakMinutes: number, span: number): number {
  if (!Number.isFinite(breakMinutes) || breakMinutes <= 0) return 0;
  return Math.min(Math.round(breakMinutes), Math.max(0, span));
}

/**
 * Resolve an assignment's effective schedule against its shift. An assignment
 * override applies only when BOTH its start and end are set; otherwise the
 * shift's nominal times stand (the original behaviour every legacy row keeps).
 * The break always comes from the assignment (default 0).
 */
export function resolveSchedule(
  assignment: AssignmentScheduleLike | null | undefined,
  shift: ShiftLike,
): ResolvedSchedule {
  const hasOverride = Boolean(assignment?.startTime && assignment?.endTime);
  const start = minutesToTime(
    timeToMinutes(hasOverride ? assignment!.startTime! : shift.startTime),
  );
  const end = minutesToTime(
    timeToMinutes(hasOverride ? assignment!.endTime! : shift.endTime),
  );
  const span = spanMinutes(start, end);
  const breakMinutes = clampBreakMinutes(assignment?.breakMinutes ?? 0, span);
  return {
    start,
    end,
    breakMinutes,
    spanMinutes: span,
    netMinutes: Math.max(0, span - breakMinutes),
    custom: hasOverride || breakMinutes > 0,
  };
}

/** Human duration: 480 → "8h", 450 → "7h 30m", 30 → "30m", 0 → "0m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

export type ScheduleEdit = {
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
};

export type ValidatedSchedule = {
  start: string;
  end: string;
  breakMinutes: number;
};

/**
 * Validate + normalise a timeline edit (from resize / break drop). Snaps both
 * ends to the grid, enforces a same-day block of at least MIN_SHIFT_MINUTES,
 * and clamps the break to fit. Returns the storable "HH:MM" times + break, or a
 * reason string the caller can surface. The server action re-parses raw numbers
 * with zod first; this is the domain rule everything shares.
 */
export function validateScheduleEdit(
  edit: ScheduleEdit,
): { ok: true; value: ValidatedSchedule } | { ok: false; reason: string } {
  const start = snapMinutes(edit.startMinutes);
  const end = snapMinutes(edit.endMinutes);
  if (start < 0 || end > DAY_MINUTES) {
    return { ok: false, reason: "Times must be within the day." };
  }
  if (end - start < MIN_SHIFT_MINUTES) {
    return {
      ok: false,
      reason: `Shift must be at least ${MIN_SHIFT_MINUTES} minutes.`,
    };
  }
  const span = end - start;
  const breakMinutes = clampBreakMinutes(edit.breakMinutes, span);
  if (breakMinutes >= span) {
    return { ok: false, reason: "Break can't fill the whole shift." };
  }
  return {
    ok: true,
    value: {
      start: minutesToTime(start),
      end: minutesToTime(end),
      breakMinutes,
    },
  };
}

/**
 * Where an unpaid break sits inside a block, as [breakStart, breakEnd] minutes
 * from midnight, centred in the block. Position is presentational only (we store
 * just the length); net hours don't depend on it. Returns null for no break.
 */
export function breakPlacement(
  start: ClockTime,
  end: ClockTime,
  breakMinutes: number,
): { start: number; end: number } | null {
  if (breakMinutes <= 0) return null;
  const s = timeToMinutes(start);
  const span = spanMinutes(start, end);
  const b = Math.min(breakMinutes, span);
  const mid = s + span / 2;
  const bStart = mid - b / 2;
  return { start: bStart, end: bStart + b };
}
