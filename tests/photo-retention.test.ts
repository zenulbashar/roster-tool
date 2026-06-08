import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, timesheetEntries, clockPhotos } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * Integration coverage for the clock-in photo retention sweep against the local
 * Postgres: expired photos are deleted, recent photos are kept, timesheet
 * entries are NEVER deleted, and the sweep stays scoped to its own business.
 */
describe("photo retention", () => {
  let businessA = "";
  let businessB = "";
  const NOW = new Date("2026-06-08T03:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]);

  beforeAll(async () => {
    // A keeps photos 7 days; B keeps them 90 — proving per-business retention.
    const [a] = await db
      .insert(businesses)
      .values({ name: "Retention Biz A", photoRetentionDays: 7 })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Retention Biz B", photoRetentionDays: 90 })
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

  /** Create a clocked-out entry at `clockInAt` with one "in" photo. */
  async function entryWithPhoto(businessId: string, clockInAt: Date) {
    const repo = createTenantRepo(businessId);
    const staff = await repo.addStaff({
      name: `Staff ${clockInAt.toISOString()}`,
      email: `s-${businessId}-${clockInAt.getTime()}@t.test`,
    });
    const entry = await repo.clockIn(staff.id, { at: clockInAt });
    await repo.clockOut(entry.id, new Date(clockInAt.getTime() + 4 * 3600_000));
    const photo = await repo.addClockPhoto({
      timesheetEntryId: entry.id,
      kind: "in",
      mimeType: "image/jpeg",
      imageData: bytes,
    });
    return { entryId: entry.id, photoId: photo!.id };
  }

  const photoExists = async (id: string) =>
    (await db.select().from(clockPhotos).where(eq(clockPhotos.id, id))).length >
    0;
  const entryExists = async (id: string) =>
    (
      await db
        .select()
        .from(timesheetEntries)
        .where(eq(timesheetEntries.id, id))
    ).length > 0;

  it("deletes expired photos, keeps recent ones, and never deletes entries", async () => {
    const old = await entryWithPhoto(
      businessA,
      new Date(NOW.getTime() - 30 * DAY),
    );
    const recent = await entryWithPhoto(
      businessA,
      new Date(NOW.getTime() - 1 * DAY),
    );

    const repoA = createTenantRepo(businessA);
    const purged = await repoA.deleteExpiredPhotos(NOW);
    expect(purged).toBe(1);

    // Old photo gone, recent photo kept.
    expect(await photoExists(old.photoId)).toBe(false);
    expect(await photoExists(recent.photoId)).toBe(true);

    // Both timesheet entries (and their hours) are preserved.
    expect(await entryExists(old.entryId)).toBe(true);
    expect(await entryExists(recent.entryId)).toBe(true);

    // Idempotent: a second sweep deletes nothing.
    expect(await repoA.deleteExpiredPhotos(NOW)).toBe(0);
  });

  it("respects each business's own retention period and tenant scope", async () => {
    // Same 30-day-old photo: expired under A's 7 days, kept under B's 90 days.
    const bPhoto = await entryWithPhoto(
      businessB,
      new Date(NOW.getTime() - 30 * DAY),
    );

    // Sweeping A must not touch B's photo.
    await createTenantRepo(businessA).deleteExpiredPhotos(NOW);
    expect(await photoExists(bPhoto.photoId)).toBe(true);

    // B's own sweep keeps it (30 days < 90-day retention).
    expect(await createTenantRepo(businessB).deleteExpiredPhotos(NOW)).toBe(0);
    expect(await photoExists(bPhoto.photoId)).toBe(true);
  });
});
