import { businessDateOf } from "@/lib/time";
import { hoursWorked } from "@/lib/timesheet-export";

/**
 * Pure aggregation: APPROVED, closed timesheet entries → Payroll 2.0 per-day
 * timesheet lines for one employee over one Xero pay period (#16).
 *
 * - Hours per entry come from the SAME `hoursWorked` (2dp) the CSV export/report
 *   use, so Roster, the export and the pushed draft all agree.
 * - Days are the ENTRY's business-LOCAL date (`businessDateOf`), matching how the
 *   report/export bucket days — never the UTC date.
 * - Only days inside the Xero period `[periodStart, periodEnd]` (inclusive) are
 *   included; the period bounds come straight from Xero (no local period math).
 * - Open entries (no clock-out) have no duration and are counted as skipped, not
 *   guessed. One line per worked day; scalar `numberOfUnits` (2.0 shape).
 */

export type PushEntry = {
  clockInAt: Date;
  clockOutAt: Date | null;
  /** Unpaid break minutes, netted out of worked hours (default 0). */
  breakMinutes?: number;
};
export type TimesheetDayLine = { date: string; numberOfUnits: number };

export function buildTimesheetLines(input: {
  entries: PushEntry[];
  timezone: string;
  /** Inclusive Xero pay-period bounds (YYYY-MM-DD), FROM the Xero calendar. */
  periodStart: string;
  periodEnd: string;
}): { lines: TimesheetDayLine[]; totalHours: number; skippedOpen: number } {
  const perDay = new Map<string, number>();
  let skippedOpen = 0;

  for (const e of input.entries) {
    const hours = hoursWorked(e.clockInAt, e.clockOutAt, e.breakMinutes ?? 0);
    if (hours === null) {
      skippedOpen++; // still clocked in — no defined duration
      continue;
    }
    if (hours <= 0) continue;
    const date = String(businessDateOf(e.clockInAt, input.timezone));
    // YYYY-MM-DD compares correctly lexicographically.
    if (date < input.periodStart || date > input.periodEnd) continue;
    perDay.set(date, round2((perDay.get(date) ?? 0) + hours));
  }

  const lines = [...perDay.entries()]
    .map(([date, sum]) => ({ date, numberOfUnits: round2(sum) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalHours = round2(lines.reduce((s, l) => s + l.numberOfUnits, 0));
  return { lines, totalHours, skippedOpen };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
