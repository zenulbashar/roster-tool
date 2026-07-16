import { describe, it, expect } from "vitest";
import {
  buildDraft,
  draftSummary,
  type ShiftLike,
  type PastAssignmentLike,
} from "@/lib/draft";

// 2025-06-14 is a Saturday, 2025-06-15 a Sunday, 2025-06-16 a Monday.
const satMorning: ShiftLike = {
  id: "cur-sat-morning",
  templateId: "tmpl-morning",
  label: "Morning",
  startTime: "07:00:00",
  endTime: "12:00:00",
  date: "2025-06-14",
};
const satEvening: ShiftLike = {
  id: "cur-sat-evening",
  templateId: "tmpl-evening",
  label: "Evening",
  startTime: "17:00:00",
  endTime: "22:00:00",
  date: "2025-06-14",
};
const monMorning: ShiftLike = {
  id: "cur-mon-morning",
  templateId: "tmpl-morning",
  label: "Morning",
  startTime: "07:00:00",
  endTime: "12:00:00",
  date: "2025-06-16",
};

// Last week's equivalents (different dates, same weekday + template).
const lastSatMorningAva: PastAssignmentLike = {
  staffMemberId: "ava",
  templateId: "tmpl-morning",
  label: "Morning",
  startTime: "07:00:00",
  endTime: "12:00:00",
  date: "2025-06-07", // also a Saturday
};
const lastSatEveningBen: PastAssignmentLike = {
  staffMemberId: "ben",
  templateId: "tmpl-evening",
  label: "Evening",
  startTime: "17:00:00",
  endTime: "22:00:00",
  date: "2025-06-07",
};
const lastMonMorningCal: PastAssignmentLike = {
  staffMemberId: "cal",
  templateId: "tmpl-morning",
  label: "Morning",
  startTime: "07:00:00",
  endTime: "12:00:00",
  date: "2025-06-09", // a Monday
};

describe("buildDraft", () => {
  it("suggests last week's person for the same shift-type + weekday when available", () => {
    const { suggestions, counts } = buildDraft({
      currentShifts: [satMorning],
      lastAssignments: [lastSatMorningAva],
      isAvailable: () => true,
    });
    expect(suggestions).toEqual([
      { shiftId: "cur-sat-morning", staffMemberId: "ava" },
    ]);
    expect(counts).toMatchObject({
      totalShifts: 1,
      suggestedShifts: 1,
      blankShifts: 0,
      blankDueToUnavailable: 0,
    });
  });

  it("leaves a shift blank (and flags it) when last week's person isn't available", () => {
    const { suggestions, counts } = buildDraft({
      currentShifts: [satMorning],
      lastAssignments: [lastSatMorningAva],
      isAvailable: () => false,
    });
    expect(suggestions).toEqual([]);
    expect(counts).toMatchObject({
      totalShifts: 1,
      suggestedShifts: 0,
      blankShifts: 1,
      blankDueToUnavailable: 1,
    });
  });

  it("does not flag blanks that simply had no one last week", () => {
    const { suggestions, counts } = buildDraft({
      currentShifts: [satMorning],
      lastAssignments: [], // nobody did this slot last week
      isAvailable: () => true,
    });
    expect(suggestions).toEqual([]);
    expect(counts).toMatchObject({
      suggestedShifts: 0,
      blankShifts: 1,
      blankDueToUnavailable: 0,
    });
  });

  it("matches by weekday, not exact date — and not across different weekdays", () => {
    // Monday template exists last week (cal) but current shift is Saturday.
    const { suggestions } = buildDraft({
      currentShifts: [satMorning],
      lastAssignments: [lastMonMorningCal],
      isAvailable: () => true,
    });
    expect(suggestions).toEqual([]);
  });

  it("only suggests available people for a mixed week", () => {
    const { suggestions, counts } = buildDraft({
      currentShifts: [satMorning, satEvening, monMorning],
      lastAssignments: [
        lastSatMorningAva,
        lastSatEveningBen,
        lastMonMorningCal,
      ],
      // Ava + Cal free, Ben not.
      isAvailable: (_shiftId, staffId) => staffId !== "ben",
    });
    expect(suggestions).toEqual([
      { shiftId: "cur-sat-morning", staffMemberId: "ava" },
      { shiftId: "cur-mon-morning", staffMemberId: "cal" },
    ]);
    expect(counts).toMatchObject({
      totalShifts: 3,
      suggestedShifts: 2,
      blankShifts: 1,
      blankDueToUnavailable: 1,
    });
  });

  it("falls back to label + times when the template was deleted", () => {
    const { suggestions } = buildDraft({
      currentShifts: [{ ...satMorning, templateId: null }],
      lastAssignments: [{ ...lastSatMorningAva, templateId: null }],
      isAvailable: () => true,
    });
    expect(suggestions).toEqual([
      { shiftId: "cur-sat-morning", staffMemberId: "ava" },
    ]);
  });
});

describe("buildDraft fill-to-target", () => {
  const need3: ShiftLike = { ...satMorning, requiredStaff: 3 };
  const allYes = () => true;

  it("tops up an understaffed shift with available staff after last week's crew", () => {
    const { suggestions, counts } = buildDraft({
      currentShifts: [need3],
      lastAssignments: [lastSatMorningAva],
      isAvailable: allYes,
      staffIds: ["ava", "ben", "cal", "dee"],
    });
    // Ava (last week) first, then ben + cal fill to the target of 3.
    expect(suggestions.map((s) => s.staffMemberId)).toEqual([
      "ava",
      "ben",
      "cal",
    ]);
    expect(counts.shortShifts).toBe(0);
  });

  it("never fills beyond the target and never without staffIds", () => {
    const capped = buildDraft({
      currentShifts: [{ ...satMorning, requiredStaff: 1 }],
      lastAssignments: [],
      isAvailable: allYes,
      staffIds: ["ava", "ben"],
    });
    expect(capped.suggestions).toHaveLength(1);

    const legacy = buildDraft({
      currentShifts: [need3],
      lastAssignments: [lastSatMorningAva],
      isAvailable: allYes,
    });
    // No staffIds = the original last-week-only behaviour.
    expect(legacy.suggestions.map((s) => s.staffMemberId)).toEqual(["ava"]);
    expect(legacy.counts.shortShifts).toBe(1);
  });

  it("counts existing assignments toward the target and never re-suggests them", () => {
    const { suggestions } = buildDraft({
      currentShifts: [need3],
      lastAssignments: [],
      isAvailable: allYes,
      staffIds: ["ava", "ben", "cal"],
      existingAssignments: [
        { shiftId: need3.id, staffMemberId: "ava" },
        { shiftId: need3.id, staffMemberId: "ben" },
      ],
    });
    expect(suggestions).toEqual([{ shiftId: need3.id, staffMemberId: "cal" }]);
  });

  it("only tops up with people who explicitly said yes and aren't on leave", () => {
    const { suggestions, counts } = buildDraft({
      currentShifts: [need3],
      lastAssignments: [],
      isAvailable: (_shift, staffId) => staffId === "ben" || staffId === "cal",
      isOnLeave: (_shift, staffId) => staffId === "cal",
      staffIds: ["ava", "ben", "cal", "dee"],
    });
    expect(suggestions.map((s) => s.staffMemberId)).toEqual(["ben"]);
    // Still 2 short of 3 — counted, never guessed.
    expect(counts.shortShifts).toBe(1);
  });

  it("spreads top-ups by fewest shifts held this week", () => {
    // Ava already holds two shifts this week; Ben holds none. Two one-person
    // shifts need cover: Ben should get the first, then Ava the second (both
    // are then equally eligible for spreading).
    const shiftA: ShiftLike = { ...satMorning, id: "a" };
    const shiftB: ShiftLike = { ...satEvening, id: "b" };
    const { suggestions } = buildDraft({
      currentShifts: [shiftA, shiftB],
      lastAssignments: [],
      isAvailable: allYes,
      staffIds: ["ava", "ben"],
      existingAssignments: [
        { shiftId: "x1", staffMemberId: "ava" },
        { shiftId: "x2", staffMemberId: "ava" },
      ],
    });
    expect(suggestions).toEqual([
      { shiftId: "a", staffMemberId: "ben" },
      { shiftId: "b", staffMemberId: "ben" },
    ]);
    // Ben (load 0 → 1) still beats Ava (load 2) on the second shift.
  });

  it("summary mentions shifts still below target", () => {
    expect(
      draftSummary({
        totalShifts: 5,
        suggestedShifts: 4,
        blankShifts: 1,
        blankDueToUnavailable: 0,
        shortShifts: 2,
      }),
    ).toBe(
      "Suggested 4 of 5 shifts based on last week and availability. 2 shifts still below the staff target — no one else said they're available.",
    );
  });
});

describe("draftSummary", () => {
  it("summarises suggestions and unavailable blanks", () => {
    expect(
      draftSummary({
        totalShifts: 21,
        suggestedShifts: 14,
        blankShifts: 7,
        blankDueToUnavailable: 4,
      }),
    ).toBe(
      "Suggested 14 of 21 shifts based on last week and availability. 4 shifts left blank — those staff aren't available this week.",
    );
  });

  it("omits the blank clause when nothing was blank due to availability", () => {
    expect(
      draftSummary({
        totalShifts: 10,
        suggestedShifts: 10,
        blankShifts: 0,
        blankDueToUnavailable: 0,
      }),
    ).toBe("Suggested 10 of 10 shifts based on last week and availability.");
  });

  it("uses singular wording for one shift", () => {
    expect(
      draftSummary({
        totalShifts: 1,
        suggestedShifts: 0,
        blankShifts: 1,
        blankDueToUnavailable: 1,
      }),
    ).toBe(
      "Suggested 0 of 1 shift based on last week and availability. 1 shift left blank — those staff aren't available this week.",
    );
  });
});
