import { describe, it, expect } from "vitest";
import { expandTemplatesToShifts, type TemplateLike } from "@/lib/roster";

const morning: TemplateLike = {
  id: "m",
  label: "Morning",
  startTime: "07:00:00",
  endTime: "12:00:00",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};
const weekendEvening: TemplateLike = {
  id: "e",
  label: "Evening",
  startTime: "17:00:00",
  endTime: "22:00:00",
  weekdays: [6, 7], // Sat, Sun only
};

describe("expandTemplatesToShifts", () => {
  it("creates one shift per applicable day", () => {
    // 2025-06-09 (Mon) .. 2025-06-15 (Sun) = 7 days
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-15" },
      [morning],
    );
    expect(shifts).toHaveLength(7);
    expect(shifts[0]).toMatchObject({
      templateId: "m",
      date: "2025-06-09",
      label: "Morning",
    });
  });

  it("applies a per-weekday staffing override only on that weekday", () => {
    // 2025-06-09 Mon .. 2025-06-15 Sun; Friday is 2025-06-13 (ISO weekday 5).
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-15" },
      [{ ...morning, requiredStaff: 2, dayStaffOverrides: { "5": 4 } }],
    );
    expect(shifts.find((s) => s.date === "2025-06-13")?.requiredStaff).toBe(4);
    expect(shifts.find((s) => s.date === "2025-06-12")?.requiredStaff).toBe(2);
  });

  it("ignores a staffing override for a weekday the type doesn't run", () => {
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-15" },
      [{ ...weekendEvening, requiredStaff: 2, dayStaffOverrides: { "1": 9 } }],
    );
    // Sat + Sun only; the Monday override never materialises.
    expect(shifts.map((s) => s.requiredStaff)).toEqual([2, 2]);
  });

  it("snapshots the staffing target, defaulting to 1", () => {
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-10" },
      [morning, { ...weekendEvening, weekdays: [1, 2], requiredStaff: 3 }],
    );
    expect(shifts.filter((s) => s.label === "Morning")[0]?.requiredStaff).toBe(
      1,
    );
    expect(
      shifts.filter((s) => s.label === "Evening").map((s) => s.requiredStaff),
    ).toEqual([3, 3]);
  });

  it("respects weekday restrictions", () => {
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-15" },
      [weekendEvening],
    );
    expect(shifts.map((s) => s.date)).toEqual(["2025-06-14", "2025-06-15"]);
  });

  it("combines multiple templates per day", () => {
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-14", endDate: "2025-06-14" }, // a Saturday
      [morning, weekendEvening],
    );
    expect(shifts).toHaveLength(2);
    expect(shifts.map((s) => s.label)).toEqual(["Morning", "Evening"]);
  });

  it("returns nothing when no template matches", () => {
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-13" }, // Mon..Fri
      [weekendEvening],
    );
    expect(shifts).toHaveLength(0);
  });

  it("applies a per-day time override only on that weekday", () => {
    // Morning 08:00 default, but 10:00 on Sunday (ISO 7).
    const withOverride: TemplateLike = {
      ...morning,
      startTime: "08:00",
      endTime: "14:00",
      dayTimeOverrides: { "7": { start: "10:00", end: "14:00" } },
    };
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-15" }, // Mon..Sun
      [withOverride],
    );
    const mon = shifts.find((s) => s.date === "2025-06-09")!;
    const sun = shifts.find((s) => s.date === "2025-06-15")!;
    expect(mon.startTime).toBe("08:00");
    expect(mon.endTime).toBe("14:00");
    // Sunday uses the override start, keeping the (same) end.
    expect(sun.startTime).toBe("10:00");
    expect(sun.endTime).toBe("14:00");
  });

  it("ignores an override for a weekday the type doesn't run", () => {
    const withOverride: TemplateLike = {
      ...weekendEvening, // Sat, Sun only
      dayTimeOverrides: { "1": { start: "06:00", end: "10:00" } }, // Monday
    };
    const shifts = expandTemplatesToShifts(
      { startDate: "2025-06-09", endDate: "2025-06-15" },
      [withOverride],
    );
    // No Monday shift exists, so the override never applies.
    expect(shifts.map((s) => s.date)).toEqual(["2025-06-14", "2025-06-15"]);
    expect(shifts.every((s) => s.startTime === "17:00:00")).toBe(true);
  });
});
