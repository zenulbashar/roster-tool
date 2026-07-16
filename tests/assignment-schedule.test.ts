import { describe, expect, it } from "vitest";
import {
  carrySchedule,
  defaultBreakStart,
  findMatchingShiftOnDate,
  formatDuration,
  minutesToTime,
  normalizeTime,
  resolveSchedule,
  sameShiftTimes,
  scheduleSegments,
  snapMinutes,
  timeToMinutes,
  validateSchedule,
  workedMinutes,
} from "@/lib/assignment-schedule";

describe("time helpers", () => {
  it("normalises Postgres HH:MM:SS and short forms to HH:MM", () => {
    expect(normalizeTime("09:00:00")).toBe("09:00");
    expect(normalizeTime("9:5")).toBe("09:05");
    expect(normalizeTime("21:30")).toBe("21:30");
  });

  it("round-trips minutes", () => {
    expect(timeToMinutes("09:00")).toBe(540);
    expect(timeToMinutes("09:00:00")).toBe(540);
    expect(timeToMinutes("bogus")).toBeNaN();
    expect(minutesToTime(540)).toBe("09:00");
    expect(minutesToTime(1439)).toBe("23:59");
    // Clamped to the day.
    expect(minutesToTime(2000)).toBe("23:59");
    expect(minutesToTime(-10)).toBe("00:00");
  });

  it("snaps to the editor step", () => {
    expect(snapMinutes(547)).toBe(540);
    expect(snapMinutes(548)).toBe(555);
    expect(snapMinutes(540)).toBe(540);
  });

  it("formats durations compactly", () => {
    expect(formatDuration(720)).toBe("12h");
    expect(formatDuration(450)).toBe("7h 30m");
    expect(formatDuration(45)).toBe("45m");
  });
});

describe("resolveSchedule", () => {
  const shift = { startTime: "09:00:00", endTime: "17:00:00" };

  it("falls back to the shift's own times with no override", () => {
    const s = resolveSchedule(shift, null);
    expect(s).toEqual({
      startTime: "09:00",
      endTime: "17:00",
      breakMinutes: 0,
      breakStart: null,
      overridden: false,
    });
  });

  it("uses the override when both times are set", () => {
    const s = resolveSchedule(shift, {
      startTime: "09:00:00",
      endTime: "21:00:00",
      breakMinutes: 30,
      breakStart: "13:00:00",
    });
    expect(s.startTime).toBe("09:00");
    expect(s.endTime).toBe("21:00");
    expect(s.breakMinutes).toBe(30);
    expect(s.breakStart).toBe("13:00");
    expect(s.overridden).toBe(true);
  });

  it("supports a break-only assignment (no time override)", () => {
    const s = resolveSchedule(shift, {
      startTime: null,
      endTime: null,
      breakMinutes: 60,
      breakStart: "12:00",
    });
    expect(s.startTime).toBe("09:00");
    expect(s.overridden).toBe(false);
    expect(s.breakMinutes).toBe(60);
    expect(s.breakStart).toBe("12:00");
  });

  it("drops a dangling breakStart when breakMinutes is 0", () => {
    const s = resolveSchedule(shift, {
      startTime: null,
      endTime: null,
      breakMinutes: 0,
      breakStart: "12:00",
    });
    expect(s.breakStart).toBeNull();
  });
});

describe("workedMinutes + segments", () => {
  it("nets the break out of the span, clamped at zero", () => {
    expect(
      workedMinutes({ startTime: "09:00", endTime: "21:00", breakMinutes: 60 }),
    ).toBe(660);
    expect(
      workedMinutes({ startTime: "09:00", endTime: "09:15", breakMinutes: 60 }),
    ).toBe(0);
  });

  it("splits the bar into two segments around the break", () => {
    expect(
      scheduleSegments({
        startTime: "09:00",
        endTime: "21:00",
        breakMinutes: 30,
        breakStart: "13:00",
      }),
    ).toEqual([
      { start: 540, end: 780 },
      { start: 810, end: 1260 },
    ]);
  });

  it("yields one segment with no break", () => {
    expect(
      scheduleSegments({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 0,
        breakStart: null,
      }),
    ).toEqual([{ start: 540, end: 1020 }]);
  });

  it("intersects a break that leaks past the edges", () => {
    // Break starts at the very end — nothing to gap.
    expect(
      scheduleSegments({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 60,
        breakStart: "16:30",
      }),
    ).toEqual([{ start: 540, end: 990 }]);
  });

  it("returns nothing for a degenerate span", () => {
    expect(
      scheduleSegments({
        startTime: "17:00",
        endTime: "09:00",
        breakMinutes: 0,
        breakStart: null,
      }),
    ).toEqual([]);
  });
});

describe("defaultBreakStart", () => {
  it("centres the break, snapped to the step", () => {
    expect(defaultBreakStart("09:00", "17:00", 30)).toBe("12:45");
    expect(defaultBreakStart("09:00", "21:00", 60)).toBe("14:30");
  });

  it("clamps so the whole break fits", () => {
    expect(defaultBreakStart("09:00", "09:30", 30)).toBe("09:00");
  });
});

describe("validateSchedule", () => {
  it("accepts a plain 9-to-9 with a 30 min break", () => {
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "21:00",
        breakMinutes: 30,
        breakStart: "13:00",
      }).ok,
    ).toBe(true);
  });

  it("rejects invalid times, tiny spans and reversed times", () => {
    expect(
      validateSchedule({
        startTime: "25:00",
        endTime: "17:00",
        breakMinutes: 0,
        breakStart: null,
      }).ok,
    ).toBe(false);
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "09:05",
        breakMinutes: 0,
        breakStart: null,
      }).ok,
    ).toBe(false);
    expect(
      validateSchedule({
        startTime: "17:00",
        endTime: "09:00",
        breakMinutes: 0,
        breakStart: null,
      }).ok,
    ).toBe(false);
  });

  it("rejects a break length outside none/30/60", () => {
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 45,
        breakStart: "12:00",
      }).ok,
    ).toBe(false);
  });

  it("requires the break to sit fully inside the times", () => {
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 60,
        breakStart: "16:30",
      }).ok,
    ).toBe(false);
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 60,
        breakStart: "08:00",
      }).ok,
    ).toBe(false);
  });

  it("requires a breakStart with a break and none without", () => {
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 30,
        breakStart: null,
      }).ok,
    ).toBe(false);
    expect(
      validateSchedule({
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 0,
        breakStart: "12:00",
      }).ok,
    ).toBe(false);
  });
});

describe("carrySchedule", () => {
  const assignment = {
    startTime: "10:00",
    endTime: "20:00",
    breakMinutes: 30,
    breakStart: "14:00",
  };

  it("keeps the override when target base times match", () => {
    const src = { startTime: "09:00:00", endTime: "17:00:00" };
    const tgt = { startTime: "09:00", endTime: "17:00" };
    expect(carrySchedule(assignment, src, tgt)).toEqual(assignment);
  });

  it("resets to target times when they differ, keeping a fitting break", () => {
    const src = { startTime: "09:00", endTime: "17:00" };
    const tgt = { startTime: "12:00", endTime: "22:00" };
    expect(carrySchedule(assignment, src, tgt)).toEqual({
      startTime: null,
      endTime: null,
      breakMinutes: 30,
      breakStart: "14:00",
    });
  });

  it("drops the break too when it no longer fits", () => {
    const src = { startTime: "09:00", endTime: "17:00" };
    const tgt = { startTime: "15:00", endTime: "23:00" };
    expect(carrySchedule(assignment, src, tgt)).toEqual({
      startTime: null,
      endTime: null,
      breakMinutes: 0,
      breakStart: null,
    });
  });

  it("compares times HH:MM-normalised", () => {
    expect(
      sameShiftTimes(
        { startTime: "09:00:00", endTime: "17:00:00" },
        { startTime: "09:00", endTime: "17:00" },
      ),
    ).toBe(true);
  });
});

describe("findMatchingShiftOnDate", () => {
  const monMorning = {
    id: "a",
    templateId: "t1",
    label: "Morning",
    startTime: "08:00",
    endTime: "14:00",
    date: "2026-07-13",
  };
  const tueMorning = { ...monMorning, id: "b", date: "2026-07-14" };
  const tueClose = {
    id: "c",
    templateId: "t2",
    label: "Close",
    startTime: "16:00",
    endTime: "22:00",
    date: "2026-07-14",
  };
  const all = [monMorning, tueMorning, tueClose];

  it("matches by template id first", () => {
    expect(findMatchingShiftOnDate(all, monMorning, "2026-07-14")?.id).toBe(
      "b",
    );
  });

  it("falls back to label + times when the template is gone", () => {
    const orphanSource = { ...monMorning, templateId: null };
    const orphanTarget = { ...tueMorning, templateId: null };
    expect(
      findMatchingShiftOnDate(
        [orphanSource, orphanTarget, tueClose],
        orphanSource,
        "2026-07-14",
      )?.id,
    ).toBe("b");
  });

  it("returns null when the date has no matching block", () => {
    expect(findMatchingShiftOnDate(all, tueClose, "2026-07-13")).toBeNull();
    expect(findMatchingShiftOnDate(all, monMorning, "2026-07-15")).toBeNull();
  });

  it("never matches the source shift itself", () => {
    expect(findMatchingShiftOnDate(all, tueMorning, "2026-07-14")).toBeNull();
  });
});
