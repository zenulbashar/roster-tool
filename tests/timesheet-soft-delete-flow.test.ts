import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, clockPhotos, timesheetEntries } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";

/**
 * UX-04: a timesheet entry is wage evidence, so "Delete" is a SOFT delete —
 * the row stays (with `deleted_at`), every tenant read hides it, its photos go
 * (privacy), and the owner can undo. The one-open-entry guard only counts live
 * rows, so deleting a stale "still clocked in" entry frees the person.
 */
describe("timesheet entry soft delete", () => {
  let bizA = "";
  let bizB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Soft Delete A", timezone: "UTC" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Soft Delete B", timezone: "UTC" })
      .returning();
    bizA = a!.id;
    bizB = b!.id;
    repoA = createTenantRepo(bizA);
    repoB = createTenantRepo(bizB);
    staffA = (await repoA.addStaff({ name: "Ava", email: "ava@softdel.test" }))
      .id;
  });

  afterAll(async () => {
    await db.delete(businesses).where(inArray(businesses.id, [bizA, bizB]));
  });

  it("keeps the row, hides it from every read, removes its photos, and can be restored", async () => {
    const at = new Date("2026-06-08T09:00:00Z");
    const entry = await repoA.clockIn(staffA, { at });
    await repoA.clockOut(entry.id, new Date("2026-06-08T17:00:00Z"));
    await repoA.setEntryApproved(entry.id, true);
    await repoA.addClockPhoto({
      timesheetEntryId: entry.id,
      kind: "in",
      mimeType: "image/jpeg",
      imageData: Buffer.from("not really a jpeg"),
    });
    const from = new Date("2026-06-08T00:00:00Z");
    const to = new Date("2026-06-09T00:00:00Z");
    expect((await repoA.listEntriesBetween(from, to)).map((e) => e.id)).toEqual(
      [entry.id],
    );
    expect(await repoA.countTimesheetEntriesForStaff(staffA)).toBe(1);

    const deleted = await repoA.deleteEntry(entry.id);
    expect(deleted?.id).toBe(entry.id);
    expect(deleted?.deletedAt).toBeInstanceOf(Date);

    // Invisible to every tenant read that feeds a screen, an export or Xero.
    expect(await repoA.getEntry(entry.id)).toBeNull();
    expect(await repoA.listEntriesBetween(from, to)).toEqual([]);
    expect(await repoA.listApprovedEntriesForExport(from, to)).toEqual([]);
    expect(await repoA.listEntriesForLabourReport(from, to)).toEqual([]);
    expect(await repoA.listApprovedClosedEntriesForPush(from, to)).toEqual([]);
    expect(await repoA.countTimesheetEntriesForStaff(staffA)).toBe(0);
    // And no longer editable.
    expect(
      await repoA.updateEntry(entry.id, { clockInAt: at, clockOutAt: null }),
    ).toBeNull();
    expect(await repoA.setEntryApproved(entry.id, false)).toBeNull();
    expect(
      await repoA.addClockPhoto({
        timesheetEntryId: entry.id,
        kind: "out",
        mimeType: "image/jpeg",
        imageData: Buffer.from("x"),
      }),
    ).toBeNull();

    // ...but the evidence is still in the table, exactly as it was.
    const [raw] = await db
      .select()
      .from(timesheetEntries)
      .where(eq(timesheetEntries.id, entry.id));
    expect(raw?.deletedAt).not.toBeNull();
    expect(raw?.approved).toBe(true);
    expect(raw?.clockOutAt?.toISOString()).toBe("2026-06-08T17:00:00.000Z");
    // The photo, though, is gone (privacy).
    expect(
      await db
        .select({ id: clockPhotos.id })
        .from(clockPhotos)
        .where(eq(clockPhotos.timesheetEntryId, entry.id)),
    ).toEqual([]);

    // Idempotent: deleting again is a no-op.
    expect(await repoA.deleteEntry(entry.id)).toBeNull();

    // Undo.
    const restored = await repoA.restoreEntry(entry.id);
    expect(restored?.deletedAt).toBeNull();
    expect((await repoA.listEntriesBetween(from, to)).map((e) => e.id)).toEqual(
      [entry.id],
    );
    expect(await repoA.listApprovedEntriesForExport(from, to)).toHaveLength(1);
    // Nothing left to restore.
    expect(await repoA.restoreEntry(entry.id)).toBeNull();
  });

  it("frees the one-open-entry guard: a deleted open entry no longer blocks clocking in", async () => {
    const open = await repoA.clockIn(staffA, {
      at: new Date("2026-06-09T09:00:00Z"),
    });
    expect((await repoA.getOpenEntry(staffA))?.id).toBe(open.id);
    // Still clocked in → a second clock-in is impossible.
    await expect(
      repoA.clockIn(staffA, { at: new Date("2026-06-09T09:01:00Z") }),
    ).rejects.toThrow();

    await repoA.deleteEntry(open.id);
    expect(await repoA.getOpenEntry(staffA)).toBeNull();
    const again = await repoA.clockIn(staffA, {
      at: new Date("2026-06-09T09:05:00Z"),
    });
    expect(again.id).not.toBe(open.id);

    // Restoring the old open entry now would double-book the guard → refused,
    // and the newer entry is untouched.
    await expect(repoA.restoreEntry(open.id)).rejects.toThrow();
    expect((await repoA.getOpenEntry(staffA))?.id).toBe(again.id);
    await repoA.clockOut(again.id, new Date("2026-06-09T12:00:00Z"));
  });

  it("is tenant-scoped: another business can neither delete nor restore the entry", async () => {
    const e = await repoA.clockIn(staffA, {
      at: new Date("2026-06-10T09:00:00Z"),
    });
    await repoA.clockOut(e.id, new Date("2026-06-10T10:00:00Z"));
    expect(await repoB.deleteEntry(e.id)).toBeNull();
    expect((await repoA.getEntry(e.id))?.deletedAt).toBeNull();

    await repoA.deleteEntry(e.id);
    expect(await repoB.restoreEntry(e.id)).toBeNull();
    expect(await repoA.getEntry(e.id)).toBeNull();
  });
});
