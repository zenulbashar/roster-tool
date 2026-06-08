import { describe, it, expect } from "vitest";
import { isOnLeave, makeOnLeaveLookup } from "@/lib/leave";
import { buildDraft } from "@/lib/draft";

/**
 * Pure unit coverage: the on-leave date helper at its range boundaries, the
 * multi-range lookup, and the draft engine skipping a staff member who is on
 * approved leave on a shift's day.
 */
describe("isOnLeave", () => {
  const range = { startDate: "2026-06-10", endDate: "2026-06-14" };

  it("is false the day before the range starts", () => {
    expect(isOnLeave("2026-06-09", range)).toBe(false);
  });

  it("is true on the first day (inclusive start)", () => {
    expect(isOnLeave("2026-06-10", range)).toBe(true);
  });

  it("is true in the middle", () => {
    expect(isOnLeave("2026-06-12", range)).toBe(true);
  });

  it("is true on the last day (inclusive end)", () => {
    expect(isOnLeave("2026-06-14", range)).toBe(true);
  });

  it("is false the day after the range ends", () => {
    expect(isOnLeave("2026-06-15", range)).toBe(false);
  });

  it("handles a single-day range", () => {
    const single = { startDate: "2026-06-10", endDate: "2026-06-10" };
    expect(isOnLeave("2026-06-10", single)).toBe(true);
    expect(isOnLeave("2026-06-11", single)).toBe(false);
  });
});

describe("makeOnLeaveLookup", () => {
  const lookup = makeOnLeaveLookup([
    { staffMemberId: "ava", startDate: "2026-06-10", endDate: "2026-06-12" },
    { staffMemberId: "ava", startDate: "2026-06-20", endDate: "2026-06-20" },
    { staffMemberId: "ben", startDate: "2026-06-11", endDate: "2026-06-11" },
  ]);

  it("matches any of a staff member's ranges", () => {
    expect(lookup("ava", "2026-06-11")).toBe(true);
    expect(lookup("ava", "2026-06-20")).toBe(true);
  });

  it("is false outside every range", () => {
    expect(lookup("ava", "2026-06-13")).toBe(false);
  });

  it("is scoped per staff member", () => {
    expect(lookup("ben", "2026-06-11")).toBe(true);
    expect(lookup("ben", "2026-06-10")).toBe(false);
    expect(lookup("nobody", "2026-06-11")).toBe(false);
  });
});

describe("buildDraft skips on-leave staff", () => {
  const lastAssignments = [
    {
      staffMemberId: "ava",
      templateId: "t1",
      label: "Morning",
      startTime: "07:00:00",
      endTime: "12:00:00",
      date: "2026-06-03", // a Wednesday
    },
  ];
  // This week's matching Wednesday shift.
  const currentShifts = [
    {
      id: "shift1",
      templateId: "t1",
      label: "Morning",
      startTime: "07:00:00",
      endTime: "12:00:00",
      date: "2026-06-10", // also a Wednesday
    },
  ];

  it("suggests an available person not on leave", () => {
    const { suggestions } = buildDraft({
      currentShifts,
      lastAssignments,
      isAvailable: () => true,
      isOnLeave: () => false,
    });
    expect(suggestions).toEqual([{ shiftId: "shift1", staffMemberId: "ava" }]);
  });

  it("does NOT suggest a person on approved leave that day", () => {
    const onLeave = makeOnLeaveLookup([
      { staffMemberId: "ava", startDate: "2026-06-10", endDate: "2026-06-10" },
    ]);
    const { suggestions, counts } = buildDraft({
      currentShifts,
      lastAssignments,
      isAvailable: () => true,
      isOnLeave: (_shiftId, staffId) => onLeave(staffId, "2026-06-10"),
    });
    expect(suggestions).toEqual([]);
    // The slot's previous person exists but is skipped → counts as blank.
    expect(counts.blankDueToUnavailable).toBe(1);
  });
});
