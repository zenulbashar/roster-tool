import { describe, expect, it } from "vitest";
import {
  estimateRosterCost,
  findAssignmentOverlaps,
  wouldOverlap,
} from "@/lib/roster-insights";

const shifts = [
  { id: "morning", date: "2026-07-31", startTime: "08:00", endTime: "14:00" },
  { id: "mid", date: "2026-07-31", startTime: "12:00", endTime: "18:00" },
  { id: "close", date: "2026-07-31", startTime: "14:00", endTime: "22:00" },
  { id: "sat", date: "2026-08-01", startTime: "08:00", endTime: "14:00" },
];

const plain = {
  startTime: null,
  endTime: null,
  breakMinutes: 0,
  breakStart: null,
};

describe("findAssignmentOverlaps", () => {
  it("flags the same person on two clashing shifts the same day", () => {
    const pairs = findAssignmentOverlaps({
      shifts,
      assignments: [
        {
          shiftId: "morning",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
        { shiftId: "mid", staffMemberId: "ava", status: "confirmed", ...plain },
      ],
    });
    expect(pairs).toEqual([
      {
        staffMemberId: "ava",
        date: "2026-07-31",
        shiftIds: ["morning", "mid"],
      },
    ]);
  });

  it("back-to-back shifts are NOT an overlap; nor are other people/days", () => {
    expect(
      findAssignmentOverlaps({
        shifts,
        assignments: [
          {
            shiftId: "morning",
            staffMemberId: "ava",
            status: "confirmed",
            ...plain,
          },
          {
            shiftId: "close",
            staffMemberId: "ava",
            status: "confirmed",
            ...plain,
          },
          {
            shiftId: "mid",
            staffMemberId: "ben",
            status: "confirmed",
            ...plain,
          },
          {
            shiftId: "sat",
            staffMemberId: "ava",
            status: "confirmed",
            ...plain,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("uses EFFECTIVE times — an override can create or clear an overlap", () => {
    // Morning stretched to 15:00 now clashes with Close (14:00 start).
    const created = findAssignmentOverlaps({
      shifts,
      assignments: [
        {
          shiftId: "morning",
          staffMemberId: "ava",
          status: "confirmed",
          startTime: "08:00",
          endTime: "15:00",
          breakMinutes: 0,
          breakStart: null,
        },
        {
          shiftId: "close",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
      ],
    });
    expect(created).toHaveLength(1);

    // Mid shrunk to start at 14:00 no longer clashes with Morning.
    const cleared = findAssignmentOverlaps({
      shifts,
      assignments: [
        {
          shiftId: "morning",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
        {
          shiftId: "mid",
          staffMemberId: "ava",
          status: "confirmed",
          startTime: "14:00",
          endTime: "18:00",
          breakMinutes: 0,
          breakStart: null,
        },
      ],
    });
    expect(cleared).toEqual([]);
  });

  it("catches an overnight shift clashing across the date line", () => {
    const nightShifts = [
      // Fri 22:00 – Sat 06:00 (overnight, anchored to Friday).
      {
        id: "friNight",
        date: "2026-07-31",
        startTime: "22:00",
        endTime: "06:00",
      },
      // Sat 05:00 – 11:00 — starts before the night shift ends.
      {
        id: "satEarly",
        date: "2026-08-01",
        startTime: "05:00",
        endTime: "11:00",
      },
      // Sat 08:00 – 14:00 — after the night shift ends; no clash.
      {
        id: "satLate",
        date: "2026-08-01",
        startTime: "08:00",
        endTime: "14:00",
      },
    ];
    const clash = findAssignmentOverlaps({
      shifts: nightShifts,
      assignments: [
        {
          shiftId: "friNight",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
        {
          shiftId: "satEarly",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
      ],
    });
    expect(clash).toEqual([
      {
        staffMemberId: "ava",
        date: "2026-07-31",
        shiftIds: ["friNight", "satEarly"],
      },
    ]);
    expect(
      findAssignmentOverlaps({
        shifts: nightShifts,
        assignments: [
          {
            shiftId: "friNight",
            staffMemberId: "ava",
            status: "confirmed",
            ...plain,
          },
          {
            shiftId: "satLate",
            staffMemberId: "ava",
            status: "confirmed",
            ...plain,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("suggested chips count too — accepting them shouldn't spring a surprise", () => {
    const pairs = findAssignmentOverlaps({
      shifts,
      assignments: [
        {
          shiftId: "morning",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
        { shiftId: "mid", staffMemberId: "ava", status: "suggested", ...plain },
      ],
    });
    expect(pairs).toHaveLength(1);
  });

  it("wouldOverlap answers the drag-hover question", () => {
    expect(
      wouldOverlap({ startTime: "12:00", endTime: "18:00" }, [
        { startTime: "08:00", endTime: "14:00" },
      ]),
    ).toBe(true);
    expect(
      wouldOverlap({ startTime: "14:00", endTime: "22:00" }, [
        { startTime: "08:00", endTime: "14:00" },
      ]),
    ).toBe(false);
  });
});

describe("estimateRosterCost", () => {
  const staff = [
    { id: "ava", name: "Ava", payRateCents: 3000 }, // $30/h
    { id: "ben", name: "Ben", payRateCents: null },
  ];

  it("costs confirmed assignments at net hours × rate", () => {
    const est = estimateRosterCost({
      shifts,
      assignments: [
        // 6h at $30 = $180.
        {
          shiftId: "morning",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
        // Override 14:00–22:00 → 8h minus 30m break = 7.5h at $30 = $225.
        {
          shiftId: "close",
          staffMemberId: "ava",
          status: "confirmed",
          startTime: "14:00",
          endTime: "22:00",
          breakMinutes: 30,
          breakStart: "18:00",
        },
      ],
      staff,
    });
    expect(est.totalMinutes).toBe(360 + 450);
    expect(est.costCents).toBe(18000 + 22500);
    expect(est.unratedMinutes).toBe(0);
    expect(est.assignmentCount).toBe(2);
  });

  it("suggestions cost nothing; unrated staff flag hours but never $0", () => {
    const est = estimateRosterCost({
      shifts,
      assignments: [
        {
          shiftId: "morning",
          staffMemberId: "ava",
          status: "suggested",
          ...plain,
        },
        { shiftId: "mid", staffMemberId: "ben", status: "confirmed", ...plain },
      ],
      staff,
    });
    expect(est.costCents).toBe(0);
    expect(est.totalMinutes).toBe(360);
    expect(est.unratedMinutes).toBe(360);
    expect(est.unratedStaffNames).toEqual(["Ben"]);
  });

  it("costs an overnight shift by its wrapped span", () => {
    const est = estimateRosterCost({
      shifts: [
        {
          id: "night",
          date: "2026-07-31",
          startTime: "18:00",
          endTime: "02:00",
        },
      ],
      assignments: [
        {
          shiftId: "night",
          staffMemberId: "ava",
          status: "confirmed",
          ...plain,
        },
      ],
      staff,
    });
    // 8h at $30 = $240.
    expect(est.totalMinutes).toBe(480);
    expect(est.costCents).toBe(24000);
  });

  it("empty roster → zeros", () => {
    const est = estimateRosterCost({ shifts, assignments: [], staff });
    expect(est).toEqual({
      totalMinutes: 0,
      costCents: 0,
      unratedMinutes: 0,
      unratedStaffNames: [],
      assignmentCount: 0,
    });
  });
});
