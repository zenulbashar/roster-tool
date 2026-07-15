/**
 * Pure clock-in/out helpers. No DB, no clock reads except the `now` you pass —
 * so every branch is testable. Durations are derived from the stored UTC
 * instants; display formatting for dates/times lives in `src/lib/time.ts`.
 */

export type ClockEntry = {
  staffMemberId: string;
  clockInAt: Date;
  clockOutAt: Date | null;
};

/** Whether a staff member with this open entry (or none) is in or out. */
export function clockState(openEntry: { clockOutAt: Date | null } | null) {
  return openEntry && openEntry.clockOutAt === null ? "in" : "out";
}

/** Milliseconds elapsed since clock-in (clamped at zero). */
export function elapsedMs(clockInAt: Date, now: Date = new Date()): number {
  return Math.max(0, now.getTime() - clockInAt.getTime());
}

/**
 * NET worked duration of an entry in ms. For an open entry (no clock-out) we
 * measure up to `now` so the kiosk can show a live "so far" total. `breakMinutes`
 * is an unpaid break subtracted from the span (clamped at zero); the kiosk live
 * total passes the default 0 since a break isn't recorded until the owner edits.
 */
export function entryDurationMs(
  entry: { clockInAt: Date; clockOutAt: Date | null },
  now: Date = new Date(),
  breakMinutes = 0,
): number {
  const end = entry.clockOutAt ?? now;
  const grossMs = end.getTime() - entry.clockInAt.getTime();
  return Math.max(0, grossMs - Math.max(0, breakMinutes) * 60_000);
}

/** Format a millisecond duration as "3h 12m" (or "0m"). */
export function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Total worked ms per staff member across a set of entries. Open entries count
 * up to `now`. Returns a Map keyed by staffMemberId.
 */
export function weeklyTotalsByStaff(
  entries: ClockEntry[],
  now: Date = new Date(),
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of entries) {
    const prev = totals.get(e.staffMemberId) ?? 0;
    totals.set(e.staffMemberId, prev + entryDurationMs(e, now));
  }
  return totals;
}
