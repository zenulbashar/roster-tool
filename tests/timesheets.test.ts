import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, rosterPeriods, publishedRosters } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { generateToken } from "@/lib/tokens";

/**
 * Integration coverage for the clock-in timesheet layer: tenant-scoped repo
 * methods, the database-level double-clock-in guard, rostered-shift linking,
 * and kiosk token resolution.
 */
describe("timesheets", () => {
  let businessA = "";
  let businessB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Clock Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Clock Biz B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("clocks in (open entry) then clocks out (closed)", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Ava", email: "ava@a.test" });

    expect(await repo.getOpenEntry(staff.id)).toBeNull();

    const entry = await repo.clockIn(staff.id, {
      at: new Date("2026-06-08T09:00:00Z"),
    });
    expect(entry.clockOutAt).toBeNull();
    expect((await repo.getOpenEntry(staff.id))?.id).toBe(entry.id);

    const closed = await repo.clockOut(
      entry.id,
      new Date("2026-06-08T17:00:00Z"),
    );
    expect(closed?.clockOutAt).not.toBeNull();
    expect(await repo.getOpenEntry(staff.id)).toBeNull();
  });

  it("blocks a second open entry for the same staff (partial unique)", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Ben", email: "ben@a.test" });
    await repo.clockIn(staff.id);
    await expect(repo.clockIn(staff.id)).rejects.toThrow();
  });

  it("links a clock-in to a published, confirmed rostered shift", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Cal", email: "cal@a.test" });

    const [period] = await db
      .insert(rosterPeriods)
      .values({
        businessId: businessA,
        label: "Wk",
        startDate: "2026-06-08",
        endDate: "2026-06-14",
      })
      .returning();

    const [shift] = await repo.createShifts([
      {
        rosterPeriodId: period!.id,
        date: "2026-06-10",
        label: "Morning",
        startTime: "09:00",
        endTime: "17:00",
      },
    ]);

    // No published roster yet -> no link.
    expect(
      await repo.findRosteredShiftForStaffOnDate(staff.id, "2026-06-10"),
    ).toBeNull();

    await repo.assign(shift!.id, staff.id); // confirmed
    await db.insert(publishedRosters).values({
      businessId: businessA,
      rosterPeriodId: period!.id,
      publicSlug: generateToken().token.slice(0, 16),
    });

    expect(
      await repo.findRosteredShiftForStaffOnDate(staff.id, "2026-06-10"),
    ).toBe(shift!.id);
    // A different date has no rostered shift.
    expect(
      await repo.findRosteredShiftForStaffOnDate(staff.id, "2026-06-11"),
    ).toBeNull();
  });

  it("supports owner edit, approve and delete", async () => {
    const repo = createTenantRepo(businessA);
    const staff = await repo.addStaff({ name: "Dee", email: "dee@a.test" });
    const entry = await repo.clockIn(staff.id, {
      at: new Date("2026-06-08T09:00:00Z"),
    });
    await repo.clockOut(entry.id, new Date("2026-06-08T12:00:00Z"));

    const edited = await repo.updateEntry(entry.id, {
      clockInAt: new Date("2026-06-08T08:30:00Z"),
      clockOutAt: new Date("2026-06-08T12:30:00Z"),
    });
    expect(edited?.clockInAt.toISOString()).toBe("2026-06-08T08:30:00.000Z");

    expect((await repo.setEntryApproved(entry.id, true))?.approved).toBe(true);

    await repo.deleteEntry(entry.id);
    expect(await repo.getEntry(entry.id)).toBeNull();
  });

  it("isolates timesheet data across tenants", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const staffA = await repoA.addStaff({ name: "Eve", email: "eve@a.test" });
    const entryA = await repoA.clockIn(staffA.id);

    // B cannot read, edit, approve or delete A's entry.
    expect(await repoB.getEntry(entryA.id)).toBeNull();
    expect(await repoB.getOpenEntry(staffA.id)).toBeNull();
    expect(
      await repoB.updateEntry(entryA.id, {
        clockInAt: new Date(),
        clockOutAt: null,
      }),
    ).toBeNull();
    expect(await repoB.setEntryApproved(entryA.id, true)).toBeNull();
    await repoB.deleteEntry(entryA.id);
    expect(await repoA.getEntry(entryA.id)).not.toBeNull();
  });

  it("stores and reads back a clock photo, scoped to the business", async () => {
    const repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);
    const staff = await repoA.addStaff({ name: "Flo", email: "flo@a.test" });
    const entry = await repoA.clockIn(staff.id);

    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]);
    const photo = await repoA.addClockPhoto({
      timesheetEntryId: entry.id,
      kind: "in",
      mimeType: "image/jpeg",
      imageData: bytes,
    });
    expect(photo?.id).toBeTruthy();

    const read = await repoA.getPhoto(photo!.id);
    expect(read?.mimeType).toBe("image/jpeg");
    expect(Buffer.compare(read!.imageData, bytes)).toBe(0);

    // B can't read A's photo, nor attach to A's entry.
    expect(await repoB.getPhoto(photo!.id)).toBeNull();
    expect(
      await repoB.addClockPhoto({
        timesheetEntryId: entry.id,
        kind: "in",
        mimeType: "image/jpeg",
        imageData: bytes,
      }),
    ).toBeNull();
  });

  it("resolves the kiosk business by token, rejecting wrong/rotated tokens", async () => {
    const repo = createTenantRepo(businessA);
    const first = generateToken();
    await repo.updateBusinessSettings({ kioskTokenHash: first.tokenHash });

    const resolved = await resolveKioskBusiness(first.token);
    expect(resolved?.businessId).toBe(businessA);

    // Wrong token -> null.
    expect(await resolveKioskBusiness("not-a-real-token")).toBeNull();

    // Rotating revokes the old link.
    const second = generateToken();
    await repo.updateBusinessSettings({ kioskTokenHash: second.tokenHash });
    expect(await resolveKioskBusiness(first.token)).toBeNull();
    expect((await resolveKioskBusiness(second.token))?.businessId).toBe(
      businessA,
    );
  });
});
