import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";

/**
 * Integration coverage of the drag-and-drop builder's data layer against the
 * real DB: per-assignment schedule overrides (set / clear / scoping), the
 * transactional moveAssignment (day→day, person→person, schedule carrying,
 * merging, cross-period refusal) and the override's exposure through
 * listAssignments and rosterRows. Pure maths are covered in
 * assignment-schedule.test.ts; this file is about the repository.
 */
describe("assignment schedule + move flow", () => {
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let periodId = "";
  let otherPeriodId = "";
  let ava = "";
  let ben = "";
  // Morning runs the same times Mon+Tue; Close runs different times on Tue.
  let monMorning = "";
  let tueMorning = "";
  let tueClose = "";
  let otherPeriodShift = "";

  const MON = "2026-07-13";
  const TUE = "2026-07-14";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Drag Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Drag Café B" })
      .returning();
    repoA = createTenantRepo(a!.id);
    repoB = createTenantRepo(b!.id);

    ava = (await repoA.addStaff({ name: "Ava", email: "ava@drag.test" })).id;
    ben = (await repoA.addStaff({ name: "Ben", email: "ben@drag.test" })).id;

    const period = await repoA.createPeriod({
      label: "Drag week",
      startDate: MON,
      endDate: "2026-07-19",
    });
    periodId = period.id;
    const other = await repoA.createPeriod({
      label: "Other week",
      startDate: "2026-07-20",
      endDate: "2026-07-26",
    });
    otherPeriodId = other.id;

    const created = await repoA.createShifts([
      {
        rosterPeriodId: periodId,
        date: MON,
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
      {
        rosterPeriodId: periodId,
        date: TUE,
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
      {
        rosterPeriodId: periodId,
        date: TUE,
        label: "Close",
        startTime: "15:00",
        endTime: "23:00",
      },
    ]);
    monMorning = created[0]!.id;
    tueMorning = created[1]!.id;
    tueClose = created[2]!.id;

    const [foreign] = await repoA.createShifts([
      {
        rosterPeriodId: otherPeriodId,
        date: "2026-07-20",
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
    ]);
    otherPeriodShift = foreign!.id;
  });

  it("new assignments carry no override and are exposed as such", async () => {
    await repoA.assign(monMorning, ava);
    const rows = await repoA.listAssignments(periodId);
    const mine = rows.find(
      (r) => r.shiftId === monMorning && r.staffMemberId === ava,
    );
    expect(mine).toMatchObject({
      startTime: null,
      endTime: null,
      breakMinutes: 0,
      breakStart: null,
    });
  });

  it("setAssignmentSchedule stores and clears the override", async () => {
    const set = await repoA.setAssignmentSchedule(monMorning, ava, {
      startTime: "09:00",
      endTime: "21:00",
      breakMinutes: 30,
      breakStart: "13:00",
    });
    expect(set?.startTime).toBe("09:00:00");
    expect(set?.endTime).toBe("21:00:00");
    expect(set?.breakMinutes).toBe(30);

    const cleared = await repoA.setAssignmentSchedule(monMorning, ava, null);
    expect(cleared?.startTime).toBeNull();
    expect(cleared?.breakMinutes).toBe(0);
    expect(cleared?.breakStart).toBeNull();
  });

  it("another tenant can't touch the assignment", async () => {
    expect(
      await repoB.setAssignmentSchedule(monMorning, ava, {
        startTime: "10:00",
        endTime: "11:00",
        breakMinutes: 0,
        breakStart: null,
      }),
    ).toBeNull();
    expect(
      await repoB.moveAssignment({
        fromShiftId: monMorning,
        staffMemberId: ava,
        toShiftId: tueMorning,
      }),
    ).toBeNull();
    // Still where it was, untouched.
    const rows = await repoA.listAssignments(periodId);
    const mine = rows.find(
      (r) => r.shiftId === monMorning && r.staffMemberId === ava,
    );
    expect(mine).toBeDefined();
    expect(mine?.startTime).toBeNull();
  });

  it("moves day→day, carrying the schedule when base times match", async () => {
    await repoA.setAssignmentSchedule(monMorning, ava, {
      startTime: "10:00",
      endTime: "20:00",
      breakMinutes: 60,
      breakStart: "14:00",
    });
    const moved = await repoA.moveAssignment({
      fromShiftId: monMorning,
      staffMemberId: ava,
      toShiftId: tueMorning,
    });
    expect(moved?.shiftId).toBe(tueMorning);
    expect(moved?.startTime).toBe("10:00:00");
    expect(moved?.breakMinutes).toBe(60);

    const rows = await repoA.listAssignments(periodId);
    expect(
      rows.find((r) => r.shiftId === monMorning && r.staffMemberId === ava),
    ).toBeUndefined();
  });

  it("moving to a different-times block resets the override, keeping a fitting break", async () => {
    const moved = await repoA.moveAssignment({
      fromShiftId: tueMorning,
      staffMemberId: ava,
      toShiftId: tueClose,
    });
    expect(moved?.shiftId).toBe(tueClose);
    // Override cleared (15:00–23:00 ≠ 10:00–20:00)…
    expect(moved?.startTime).toBeNull();
    expect(moved?.endTime).toBeNull();
    // …but the 60 min break still isn't lost — 14:00 doesn't fit 15:00–23:00,
    // so it IS dropped here.
    expect(moved?.breakMinutes).toBe(0);
    expect(moved?.breakStart).toBeNull();
  });

  it("moves person→person on the same shift, keeping status", async () => {
    const moved = await repoA.moveAssignment({
      fromShiftId: tueClose,
      staffMemberId: ava,
      toShiftId: tueClose,
      toStaffMemberId: ben,
    });
    expect(moved?.staffMemberId).toBe(ben);
    expect(moved?.status).toBe("confirmed");
    const rows = await repoA.listAssignments(periodId);
    expect(
      rows.find((r) => r.shiftId === tueClose && r.staffMemberId === ava),
    ).toBeUndefined();
  });

  it("refuses a move across roster periods", async () => {
    expect(
      await repoA.moveAssignment({
        fromShiftId: tueClose,
        staffMemberId: ben,
        toShiftId: otherPeriodShift,
      }),
    ).toBeNull();
    // Nothing changed.
    const rows = await repoA.listAssignments(periodId);
    expect(
      rows.find((r) => r.shiftId === tueClose && r.staffMemberId === ben),
    ).toBeDefined();
  });

  it("merges when the person is already on the target shift", async () => {
    // Ben also picks up Monday morning as a suggestion, then his confirmed
    // Tuesday close is dragged onto it — the merge upgrades to confirmed.
    await repoA.createSuggestedAssignments([
      { shiftId: monMorning, staffMemberId: ben },
    ]);
    const moved = await repoA.moveAssignment({
      fromShiftId: tueClose,
      staffMemberId: ben,
      toShiftId: monMorning,
    });
    expect(moved?.shiftId).toBe(monMorning);
    expect(moved?.status).toBe("confirmed");
    const rows = await repoA.listAssignments(periodId);
    expect(
      rows.filter((r) => r.shiftId === monMorning && r.staffMemberId === ben),
    ).toHaveLength(1);
    expect(
      rows.find((r) => r.shiftId === tueClose && r.staffMemberId === ben),
    ).toBeUndefined();
  });

  it("a same-cell drop is a no-op", async () => {
    const before = await repoA.listAssignments(periodId);
    const moved = await repoA.moveAssignment({
      fromShiftId: monMorning,
      staffMemberId: ben,
      toShiftId: monMorning,
    });
    expect(moved?.shiftId).toBe(monMorning);
    expect(await repoA.listAssignments(periodId)).toHaveLength(before.length);
  });

  it("rosterRows exposes the override for confirmed assignments", async () => {
    await repoA.setAssignmentSchedule(monMorning, ben, {
      startTime: "09:00",
      endTime: "21:00",
      breakMinutes: 30,
      breakStart: "13:00",
    });
    const rows = await repoA.rosterRows(periodId);
    const mine = rows.find(
      (r) => r.shiftId === monMorning && r.staffMemberId === ben,
    );
    expect(mine?.assignmentStartTime).toBe("09:00:00");
    expect(mine?.assignmentEndTime).toBe("21:00:00");
    expect(mine?.assignmentBreakMinutes).toBe(30);
    // Unassigned shifts still appear with null assignment fields.
    const open = rows.find((r) => r.shiftId === tueMorning);
    expect(open?.staffMemberId).toBeNull();
    expect(open?.assignmentStartTime).toBeNull();
  });
});
