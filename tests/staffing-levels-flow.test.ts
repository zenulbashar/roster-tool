import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { expandTemplatesToShifts } from "@/lib/roster";

/**
 * Integration coverage for per-shift staffing levels (hospitality: several
 * people on one shift): the template target, its snapshot at expansion, the
 * per-shift adjustment (tenant-scoped), and a regression pin that MULTIPLE
 * staff can hold one shift end-to-end (assignments + rosterRows).
 */
describe("staffing levels + multi-staff shifts", () => {
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let periodId = "";
  let fridayCloseId = "";

  afterAll(async () => {
    await db.$client.end();
  });

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Staffing Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Staffing Café B" })
      .returning();
    repoA = createTenantRepo(a!.id);
    repoB = createTenantRepo(b!.id);
  });

  it("stores and edits a template's staffing target", async () => {
    const t = await repoA.addTemplate({
      label: "Close",
      startTime: "17:00",
      endTime: "23:00",
      weekdays: [5, 6],
      requiredStaff: 3,
    });
    expect(t.requiredStaff).toBe(3);

    const updated = await repoA.updateTemplate(t.id, { requiredStaff: 4 });
    expect(updated?.requiredStaff).toBe(4);

    // Default stays 1 when not given.
    const plain = await repoA.addTemplate({
      label: "Morning",
      startTime: "08:00",
      endTime: "14:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(plain.requiredStaff).toBe(1);
  });

  it("expansion snapshots the target onto each concrete shift", async () => {
    const templates = await repoA.listTemplates({ activeOnly: true });
    const period = await repoA.createPeriod({
      label: "Staffing week",
      // 2026-07-20 (Mon) .. 2026-07-26 (Sun)
      startDate: "2026-07-20",
      endDate: "2026-07-26",
    });
    periodId = period.id;
    const rows = expandTemplatesToShifts(period, templates).map((r) => ({
      ...r,
      rosterPeriodId: period.id,
    }));
    const shifts = await repoA.createShifts(rows);

    const friday = shifts.find(
      (s) => s.label === "Close" && s.date === "2026-07-24",
    );
    expect(friday?.requiredStaff).toBe(4);
    fridayCloseId = friday!.id;
    // The 1-person type stays 1.
    expect(shifts.find((s) => s.label === "Morning")?.requiredStaff).toBe(1);
    // A later template edit must NOT rewrite the snapshot.
    const t = templates.find((x) => x.label === "Close")!;
    await repoA.updateTemplate(t.id, { requiredStaff: 2 });
    expect((await repoA.getShift(fridayCloseId))?.requiredStaff).toBe(4);
  });

  it("adjusts one shift's target, tenant-scoped", async () => {
    const row = await repoA.updateShiftRequiredStaff(fridayCloseId, 5);
    expect(row?.requiredStaff).toBe(5);
    // Another tenant can't touch it.
    expect(await repoB.updateShiftRequiredStaff(fridayCloseId, 1)).toBeNull();
    expect((await repoA.getShift(fridayCloseId))?.requiredStaff).toBe(5);
  });

  it("several staff can hold one shift, all the way to rosterRows", async () => {
    const ava = await repoA.addStaff({ name: "Ava", email: "ava@staff.test" });
    const ben = await repoA.addStaff({ name: "Ben", email: "ben@staff.test" });
    const cal = await repoA.addStaff({ name: "Cal", email: "cal@staff.test" });
    await repoA.assign(fridayCloseId, ava.id);
    await repoA.assign(fridayCloseId, ben.id);
    await repoA.assign(fridayCloseId, cal.id);

    const assignments = await repoA.listAssignments(periodId);
    expect(assignments.filter((r) => r.shiftId === fridayCloseId)).toHaveLength(
      3,
    );

    const rows = await repoA.rosterRows(periodId);
    const names = rows
      .filter((r) => r.shiftId === fridayCloseId)
      .map((r) => r.staffName)
      .sort();
    expect(names).toEqual(["Ava", "Ben", "Cal"]);

    // Each keeps an independent schedule override.
    await repoA.setAssignmentSchedule(fridayCloseId, ava.id, {
      startTime: "17:00",
      endTime: "21:00",
      breakMinutes: 0,
      breakStart: null,
    });
    const after = await repoA.listAssignments(periodId);
    expect(
      after.find(
        (r) => r.shiftId === fridayCloseId && r.staffMemberId === ava.id,
      )?.endTime,
    ).toBe("21:00:00");
    expect(
      after.find(
        (r) => r.shiftId === fridayCloseId && r.staffMemberId === ben.id,
      )?.endTime,
    ).toBeNull();
  });
});
