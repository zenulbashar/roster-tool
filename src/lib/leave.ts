import type { DateOnly } from "@/lib/time";

/**
 * Pure leave helpers used by the roster builder and "draft from last week".
 *
 * Leave is recorded as an inclusive calendar-date range ("YYYY-MM-DD"), like
 * shift dates — timezone-free. Because that format sorts lexically, a plain
 * string comparison is a correct date comparison, so these helpers need no Date
 * objects or timezone handling. They answer one question only: is a staff member
 * on (approved) leave on a given day? No balances, accruals or entitlements.
 */

/** An approved leave range for a staff member. */
export type LeaveRange = {
  staffMemberId: string;
  startDate: DateOnly;
  endDate: DateOnly;
};

/**
 * True if `date` falls within the inclusive leave range. Boundary days (the
 * first and last day of leave) count as on leave.
 */
export function isOnLeave(
  date: DateOnly,
  range: { startDate: DateOnly; endDate: DateOnly },
): boolean {
  return range.startDate <= date && date <= range.endDate;
}

/**
 * Build a fast lookup over a set of approved leave ranges:
 * `lookup(staffMemberId, date)` is true when that person has any range covering
 * that day. Used by the builder to flag on-leave staff and by the draft engine
 * to skip them. Pure and side-effect free.
 */
export function makeOnLeaveLookup(
  ranges: LeaveRange[],
): (staffMemberId: string, date: DateOnly) => boolean {
  const byStaff = new Map<string, Array<{ startDate: string; endDate: string }>>();
  for (const r of ranges) {
    const list = byStaff.get(r.staffMemberId) ?? [];
    list.push({ startDate: r.startDate, endDate: r.endDate });
    byStaff.set(r.staffMemberId, list);
  }
  return (staffMemberId: string, date: DateOnly) => {
    const list = byStaff.get(staffMemberId);
    if (!list) return false;
    return list.some((r) => isOnLeave(date, r));
  };
}
