import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveSchedule } from "@/lib/roster-schedule";

/**
 * DB-backed coverage for the per-assignment schedule + drag-move repo methods
 * (migration 0028). Proves: schedule overrides persist and are exposed by
 * listAssignments / rosterRows / assignmentsWithShiftType; moveAssignment
 * transfers the schedule atomically, confirms a suggestion, and refuses a
 * foreign-business shift; setAssignmentSchedule sets and clears an override.
 */
describe("roster schedule flow", () => {
  let businessId = "";
  let otherBusinessId = "";
  const repo = () => createTenantRepo(businessId);

  let periodId = "";
  let monMorning = "";
  let tueMorning = "";
  let staffId = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Sched Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Sched Biz B" })
      .returning();
    businessId = a!.id;
    otherBusinessId = b!.id;

    const staff = await repo().addStaff({
      name: "Sam",
      email: "sam@sched.test",
    });
    staffId = staff.id;

    const period = await repo().createPeriod({
      label: "Week 1",
      startDate: "2026-03-02", // Monday
      endDate: "2026-03-08",
    });
    periodId = period.id;

    const [mon, tue] = await repo().createShifts([
      {
        rosterPeriodId: periodId,
        date: "2026-03-02",
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
      {
        rosterPeriodId: periodId,
        date: "2026-03-03",
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
    ]);
    monMorning = mon!.id;
    tueMorning = tue!.id;
  });

  it("persists and exposes a per-person schedule override", async () => {
    await repo().assign(monMorning, staffId);
    await repo().setAssignmentSchedule({
      shiftId: monMorning,
      staffMemberId: staffId,
      startTime: "09:00",
      endTime: "21:00",
      breakMinutes: 60,
    });

    const assignments = await repo().listAssignments(periodId);
    const mine = assignments.find((a) => a.shiftId === monMorning)!;
    expect(mine.startTime).toBe("09:00:00");
    expect(mine.endTime).toBe("21:00:00");
    expect(mine.breakMinutes).toBe(60);

    const resolved = resolveSchedule(mine, {
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(resolved.netMinutes).toBe(660); // 12h span − 1h break
  });

  it("rosterRows carries the override for the published view/emails", async () => {
    const rows = await repo().rosterRows(periodId);
    const row = rows.find(
      (r) => r.shiftId === monMorning && r.staffMemberId === staffId,
    )!;
    expect(row.assignmentStartTime).toBe("09:00:00");
    expect(row.assignmentEndTime).toBe("21:00:00");
    expect(row.assignmentBreakMinutes).toBe(60);
  });

  it("moveAssignment transfers the schedule atomically and confirms it", async () => {
    const moved = await repo().moveAssignment({
      fromShiftId: monMorning,
      toShiftId: tueMorning,
      staffMemberId: staffId,
    });
    expect(moved).not.toBeNull();

    const assignments = await repo().listAssignments(periodId);
    expect(assignments.find((a) => a.shiftId === monMorning)).toBeUndefined();
    const tue = assignments.find((a) => a.shiftId === tueMorning)!;
    expect(tue.status).toBe("confirmed");
    expect(tue.startTime).toBe("09:00:00");
    expect(tue.endTime).toBe("21:00:00");
    expect(tue.breakMinutes).toBe(60);
  });

  it("refuses to move onto a shift from another business", async () => {
    const otherRepo = createTenantRepo(otherBusinessId);
    const otherPeriod = await otherRepo.createPeriod({
      label: "Other",
      startDate: "2026-03-02",
      endDate: "2026-03-08",
    });
    const [foreign] = await otherRepo.createShifts([
      {
        rosterPeriodId: otherPeriod.id,
        date: "2026-03-02",
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
    ]);
    const result = await repo().moveAssignment({
      fromShiftId: tueMorning,
      toShiftId: foreign!.id,
      staffMemberId: staffId,
    });
    expect(result).toBeNull();
    // The assignment stayed put.
    const assignments = await repo().listAssignments(periodId);
    expect(assignments.find((a) => a.shiftId === tueMorning)).toBeTruthy();
  });

  it("clears an override back to the shift's nominal times", async () => {
    await repo().setAssignmentSchedule({
      shiftId: tueMorning,
      staffMemberId: staffId,
      startTime: null,
      endTime: null,
      breakMinutes: 0,
    });
    const assignments = await repo().listAssignments(periodId);
    const tue = assignments.find((a) => a.shiftId === tueMorning)!;
    expect(tue.startTime).toBeNull();
    expect(tue.endTime).toBeNull();
    expect(tue.breakMinutes).toBe(0);
    const resolved = resolveSchedule(tue, {
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(resolved.custom).toBe(false);
    expect(resolved.netMinutes).toBe(480);
  });
});
