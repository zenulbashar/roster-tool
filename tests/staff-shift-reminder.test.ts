import { describe, it, expect } from "vitest";
import {
  buildShiftReminders,
  shiftReminderDedupeKey,
  type ShiftForReminder,
} from "@/lib/staff-shift-reminder";

const row = (over: Partial<ShiftForReminder> = {}): ShiftForReminder => ({
  staffMemberId: "ava",
  staffActive: true,
  label: "Morning",
  startTime: "08:00",
  endTime: "14:00",
  ...over,
});

describe("buildShiftReminders", () => {
  it("creates one reminder per staff member with their shift detail", () => {
    const out = buildShiftReminders(
      [row(), row({ staffMemberId: "ben", label: "Evening" })],
      "2026-06-11",
    );
    expect(out).toHaveLength(2);
    const ava = out.find((r) => r.staffMemberId === "ava")!;
    expect(ava.title).toBe("Reminder: you work tomorrow");
    expect(ava.body).toContain("11/06");
    expect(ava.body).toContain("Morning");
    expect(ava.body).toContain("8 am"); // formatTimeOnly drops :00 on the hour
    expect(ava.dedupeKey).toBe("shift_reminder:ava:2026-06-11");
  });

  it("groups multiple same-day shifts into ONE reminder", () => {
    const out = buildShiftReminders(
      [
        row(),
        row({ label: "Evening", startTime: "17:00", endTime: "21:00" }),
      ],
      "2026-06-11",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.body).toContain("Morning");
    expect(out[0]!.body).toContain("Evening");
  });

  it("skips inactive staff", () => {
    const out = buildShiftReminders([row({ staffActive: false })], "2026-06-11");
    expect(out).toEqual([]);
  });

  it("returns nothing for an empty day", () => {
    expect(buildShiftReminders([], "2026-06-11")).toEqual([]);
  });

  it("dedupe key is per staff member per date", () => {
    expect(shiftReminderDedupeKey("ava", "2026-06-11")).not.toBe(
      shiftReminderDedupeKey("ava", "2026-06-12"),
    );
    expect(shiftReminderDedupeKey("ava", "2026-06-11")).not.toBe(
      shiftReminderDedupeKey("ben", "2026-06-11"),
    );
  });
});
