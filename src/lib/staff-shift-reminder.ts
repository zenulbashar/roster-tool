import { formatDateOnly, type DateOnly, formatTimeRange } from "@/lib/time";

/**
 * Daily staff shift reminder — pure logic.
 *
 * The worker's daily sweep tells each staff member, the evening before, that
 * they work tomorrow. IN-APP ONLY: these become `staff_notification` rows on
 * the PIN-gated /me page; no email is ever sent for them (protecting the email
 * send limit). Idempotency comes from the dedupe key: one reminder per staff
 * member per date, enforced by the unique index + ON CONFLICT DO NOTHING.
 */

/** One confirmed assignment row on the target date (see the repo query). */
export type ShiftForReminder = {
  staffMemberId: string;
  staffActive: boolean;
  label: string;
  startTime: string;
  endTime: string;
};

export type ShiftReminder = {
  staffMemberId: string;
  title: string;
  body: string;
  dedupeKey: string;
};

/** The per-staff-per-date idempotency handle. */
export function shiftReminderDedupeKey(
  staffMemberId: string,
  date: DateOnly,
): string {
  return `shift_reminder:${staffMemberId}:${date}`;
}

/**
 * Group one business's confirmed assignments on `date` into ONE reminder per
 * (active) staff member, listing all their shifts that day in start-time order
 * (the rows arrive sorted). Inactive staff get no reminder.
 */
export function buildShiftReminders(
  rows: ShiftForReminder[],
  date: DateOnly,
): ShiftReminder[] {
  const byStaff = new Map<string, ShiftForReminder[]>();
  for (const row of rows) {
    if (!row.staffActive) continue;
    const list = byStaff.get(row.staffMemberId) ?? [];
    list.push(row);
    byStaff.set(row.staffMemberId, list);
  }

  return [...byStaff.entries()].map(([staffMemberId, shifts]) => ({
    staffMemberId,
    title: "Reminder: you work tomorrow",
    body: `${formatDateOnly(date)} — ${shifts
      .map((s) => `${s.label} ${formatTimeRange(s.startTime, s.endTime)}`)
      .join("; ")}`,
    dedupeKey: shiftReminderDedupeKey(staffMemberId, date),
  }));
}
