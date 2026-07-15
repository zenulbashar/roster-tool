import { describe, it, expect } from "vitest";
import {
  timeToMinutes,
  minutesToTime,
  snapMinutes,
  spanMinutes,
  clampBreakMinutes,
  resolveSchedule,
  formatDuration,
  validateScheduleEdit,
  breakPlacement,
  MIN_SHIFT_MINUTES,
  DAY_MINUTES,
} from "@/lib/roster-schedule";

describe("time <-> minutes", () => {
  it("parses HH:MM, HH:MM:SS and end-of-day 24:00", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("09:30:00")).toBe(570);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("24:00")).toBe(DAY_MINUTES);
  });
  it("formats minutes, rendering 1440 as 24:00 and clamping", () => {
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(DAY_MINUTES)).toBe("24:00");
    expect(minutesToTime(-10)).toBe("00:00");
    expect(minutesToTime(9999)).toBe("24:00");
  });
  it("snaps to the 15-minute grid within a day", () => {
    expect(snapMinutes(547)).toBe(540); // 9:07 -> 9:00
    expect(snapMinutes(548)).toBe(555); // 9:08 -> 9:15
    expect(snapMinutes(-5)).toBe(0);
    expect(snapMinutes(1439)).toBe(DAY_MINUTES);
  });
});

describe("spanMinutes", () => {
  it("same-day span", () => {
    expect(spanMinutes("09:00", "17:00")).toBe(480);
  });
  it("treats end<=start as crossing midnight", () => {
    expect(spanMinutes("22:00", "02:00")).toBe(240);
    expect(spanMinutes("18:00", "18:00")).toBe(DAY_MINUTES);
  });
  it("end of exactly 24:00 is a normal same-day end", () => {
    expect(spanMinutes("16:00", "24:00")).toBe(480);
  });
});

describe("clampBreakMinutes", () => {
  it("clamps to [0, span] and treats junk as 0", () => {
    expect(clampBreakMinutes(30, 480)).toBe(30);
    expect(clampBreakMinutes(600, 480)).toBe(480);
    expect(clampBreakMinutes(-5, 480)).toBe(0);
    expect(clampBreakMinutes(NaN, 480)).toBe(0);
  });
});

describe("resolveSchedule", () => {
  const shift = { startTime: "09:00:00", endTime: "17:00:00" };

  it("falls back to the shift's nominal times when no override", () => {
    const r = resolveSchedule(null, shift);
    expect(r).toMatchObject({
      start: "09:00",
      end: "17:00",
      breakMinutes: 0,
      spanMinutes: 480,
      netMinutes: 480,
      custom: false,
    });
  });

  it("uses the assignment override only when BOTH ends are set", () => {
    expect(
      resolveSchedule({ startTime: "09:00", endTime: "21:00" }, shift),
    ).toMatchObject({
      start: "09:00",
      end: "21:00",
      spanMinutes: 720,
      custom: true,
    });
    // Only one end set -> ignore the override, keep the shift's times.
    expect(
      resolveSchedule({ startTime: "09:00", endTime: null }, shift),
    ).toMatchObject({ start: "09:00", end: "17:00", custom: false });
  });

  it("nets the break out of worked minutes and marks custom", () => {
    const r = resolveSchedule(
      { startTime: "09:00", endTime: "21:00", breakMinutes: 60 },
      shift,
    );
    expect(r.spanMinutes).toBe(720);
    expect(r.breakMinutes).toBe(60);
    expect(r.netMinutes).toBe(660);
    expect(r.custom).toBe(true);
  });

  it("a break with no time override still counts as custom", () => {
    const r = resolveSchedule({ breakMinutes: 30 }, shift);
    expect(r.custom).toBe(true);
    expect(r.netMinutes).toBe(450);
  });
});

describe("formatDuration", () => {
  it("renders hours/minutes compactly", () => {
    expect(formatDuration(480)).toBe("8h");
    expect(formatDuration(450)).toBe("7h 30m");
    expect(formatDuration(30)).toBe("30m");
    expect(formatDuration(0)).toBe("0m");
  });
});

describe("validateScheduleEdit", () => {
  it("snaps and accepts a valid block", () => {
    const r = validateScheduleEdit({
      startMinutes: 542, // 9:02 -> 9:00
      endMinutes: 1262, // 21:02 -> 21:00
      breakMinutes: 30,
    });
    expect(r).toEqual({
      ok: true,
      value: { start: "09:00", end: "21:00", breakMinutes: 30 },
    });
  });

  it("rejects a block shorter than the minimum", () => {
    const r = validateScheduleEdit({
      startMinutes: 540,
      endMinutes: 540 + MIN_SHIFT_MINUTES - 15,
      breakMinutes: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a break that fills the shift", () => {
    const r = validateScheduleEdit({
      startMinutes: 540,
      endMinutes: 600,
      breakMinutes: 60,
    });
    expect(r.ok).toBe(false);
  });

  it("allows a block ending exactly at 24:00", () => {
    const r = validateScheduleEdit({
      startMinutes: 960,
      endMinutes: DAY_MINUTES,
      breakMinutes: 0,
    });
    expect(r).toEqual({
      ok: true,
      value: { start: "16:00", end: "24:00", breakMinutes: 0 },
    });
  });
});

describe("breakPlacement", () => {
  it("centres the break in the block", () => {
    // 9:00-17:00 (540..1020), 60-min break -> centred at 780 -> [750, 810].
    expect(breakPlacement("09:00", "17:00", 60)).toEqual({
      start: 750,
      end: 810,
    });
  });
  it("returns null for no break", () => {
    expect(breakPlacement("09:00", "17:00", 0)).toBeNull();
  });
});
