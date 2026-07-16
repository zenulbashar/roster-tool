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
    expect(suggestions).toMatchObject([
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
    expect(suggestions).toMatchObject([]);
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
    expect(suggestions).toMatchObject([]);
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
    expect(suggestions).toMatchObject([]);
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
    expect(suggestions).toMatchObject([
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
    expect(suggestions).toMatchObject([
      { shiftId: "cur-sat-morning", staffMemberId: "ava" },
    ]);
  });

  it("carries last week's per-person schedule (custom span + break) into the suggestion", () => {
    const { suggestions } = buildDraft({
      currentShifts: [satMorning],
      lastAssignments: [
        {
          ...lastSatMorningAva,
          assignmentStartTime: "09:00:00",
          assignmentEndTime: "21:00:00",
          assignmentBreakMinutes: 60,
        },
      ],
      isAvailable: () => true,
    });
    expect(suggestions).toEqual([
      {
        shiftId: "cur-sat-morning",
        staffMemberId: "ava",
        startTime: "09:00:00",
        endTime: "21:00:00",
        breakMinutes: 60,
      },
    ]);
  });

  it("suggests null schedule when last week had no override", () => {
    const { suggestions } = buildDraft({
      currentShifts: [satMorning],
      lastAssignments: [lastSatMorningAva],
      isAvailable: () => true,
    });
    expect(suggestions).toEqual([
      {
        shiftId: "cur-sat-morning",
        staffMemberId: "ava",
        startTime: null,
        endTime: null,
        breakMinutes: 0,
      },
    ]);
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
      "Suggested 14 of 21 shifts based on last week. 4 shifts left blank — those staff aren't available this week.",
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
    ).toBe("Suggested 10 of 10 shifts based on last week.");
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
      "Suggested 0 of 1 shift based on last week. 1 shift left blank — those staff aren't available this week.",
    );
  });
});
