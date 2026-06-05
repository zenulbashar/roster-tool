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
});
