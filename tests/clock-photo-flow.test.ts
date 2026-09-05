import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, clockPhotos } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { InMemoryBlobStore } from "@/lib/blob/store";
import { backfillClockPhotos } from "@/lib/blob/backfill";
import {
  clockPhotoKey,
  purgeExpiredClockPhotos,
  readClockPhoto,
  saveClockPhoto,
} from "@/lib/clock-photo-storage";
import { purgePhotosForBusiness } from "@/lib/jobs/handlers";

/**
 * PERF-06 end to end against Postgres + the in-memory store: where a photo's
 * bytes land in each write mode, that a store outage never loses a photo or
 * blocks the clock action, that reads prefer the store and fall back, that
 * retention deletes objects BEFORE rows (and keeps a row whose object could
 * not be deleted), and that the backfill is resumable and idempotent, and
 * only clears database bytes after verifying the object.
 */
describe("clock photo storage (flow)", () => {
  let biz = "";
  let other = "";
  let bizBackfill = "";
  const NOW = new Date("2026-09-05T03:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Photo Store Biz", photoRetentionDays: 7 })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Photo Store Other", photoRetentionDays: 7 })
      .returning();
    const [c] = await db
      .insert(businesses)
      .values({ name: "Photo Backfill Biz", photoRetentionDays: 7 })
      .returning();
    biz = a!.id;
    other = b!.id;
    bizBackfill = c!.id;
  });

  afterAll(async () => {
    await db
      .delete(businesses)
      .where(inArray(businesses.id, [biz, other, bizBackfill]));
    await db.$client.end();
  });

  async function entryFor(businessId: string, clockInAt: Date, tag: string) {
    const repo = createTenantRepo(businessId);
    const staff = await repo.addStaff({
      name: `P ${tag}`,
      email: `p-${tag}-${clockInAt.getTime()}@t.test`,
    });
    const entry = await repo.clockIn(staff.id, { at: clockInAt });
    await repo.clockOut(entry.id, new Date(clockInAt.getTime() + 3600_000));
    return { repo, staff, entry };
  }

  const rowOf = async (id: string) =>
    (await db.select().from(clockPhotos).where(eq(clockPhotos.id, id)))[0]!;

  it("writes to the database, both, or the store only — by mode", async () => {
    const store = new InMemoryBlobStore();
    const { repo, entry } = await entryFor(biz, NOW, "modes");
    const input = {
      timesheetEntryId: entry.id,
      kind: "in" as const,
      mimeType: "image/jpeg",
      data: jpeg,
    };

    const dbOnly = (await saveClockPhoto(repo, store, input, "database", biz))!;
    expect(dbOnly.stored).toBe(false);
    let row = await rowOf(dbOnly.id);
    expect(row.imageData).not.toBeNull();
    expect(row.storageKey).toBeNull();
    expect(store.objects.size).toBe(0);

    const dual = (await saveClockPhoto(repo, store, input, "dual", biz))!;
    expect(dual.stored).toBe(true);
    row = await rowOf(dual.id);
    const dualKey = clockPhotoKey({
      businessId: biz,
      timesheetEntryId: entry.id,
      photoId: dual.id,
      mimeType: "image/jpeg",
    });
    expect(row.storageKey).toBe(dualKey);
    expect(row.imageData).not.toBeNull();
    expect(row.contentLength).toBe(jpeg.length);
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(store.objects.get(dualKey)?.contentType).toBe("image/jpeg");

    const only = (await saveClockPhoto(repo, store, input, "store", biz))!;
    row = await rowOf(only.id);
    expect(row.imageData).toBeNull();
    expect(row.storageKey).toBeTruthy();
    expect(store.objects.size).toBe(2);

    // Reads: the store copy wins when present, else the database copy.
    const fromStore = await readClockPhoto(repo, store, only.id);
    expect(fromStore?.mimeType).toBe("image/jpeg");
    expect(Buffer.compare(fromStore!.body, jpeg)).toBe(0);
    expect(
      Buffer.compare(
        (await readClockPhoto(repo, store, dbOnly.id))!.body,
        jpeg,
      ),
    ).toBe(0);
    // A store outage on read falls back to the database copy when there is
    // one, and reports "gone" honestly when there isn't.
    store.failNext("get");
    expect(
      Buffer.compare((await readClockPhoto(repo, store, dual.id))!.body, jpeg),
    ).toBe(0);
    store.failNext("get");
    expect(await readClockPhoto(repo, store, only.id)).toBeNull();
    // Another tenant's repo can't read any of them.
    expect(
      await readClockPhoto(createTenantRepo(other), store, only.id),
    ).toBeNull();
  });

  it("a store outage on write keeps the bytes in the database instead of losing the photo", async () => {
    const store = new InMemoryBlobStore();
    const { repo, entry } = await entryFor(biz, NOW, "outage");
    store.failNext("put");
    const saved = (await saveClockPhoto(
      repo,
      store,
      {
        timesheetEntryId: entry.id,
        kind: "out",
        mimeType: "image/png",
        data: jpeg,
      },
      "store",
      biz,
    ))!;
    expect(saved.stored).toBe(false);
    const row = await rowOf(saved.id);
    expect(row.imageData).not.toBeNull();
    expect(row.storageKey).toBeNull();
    expect(store.objects.size).toBe(0);

    // A foreign entry is refused AND the already-uploaded object is removed.
    const foreign = await entryFor(other, NOW, "foreign");
    expect(
      await saveClockPhoto(
        repo,
        store,
        {
          timesheetEntryId: foreign.entry.id,
          kind: "in",
          mimeType: "image/jpeg",
          data: jpeg,
        },
        "store",
        biz,
      ),
    ).toBeNull();
    expect(store.objects.size).toBe(0);
  });

  it("retention deletes objects first, then rows, and keeps a row whose object survived", async () => {
    const store = new InMemoryBlobStore();
    const old = new Date(NOW.getTime() - 10 * DAY);
    const { repo, entry } = await entryFor(biz, old, "retention");
    const fresh = await entryFor(biz, new Date(NOW.getTime() - DAY), "keep");
    const input = (id: string, kind: "in" | "out") => ({
      timesheetEntryId: id,
      kind,
      mimeType: "image/jpeg",
      data: jpeg,
    });
    const a = (await saveClockPhoto(
      repo,
      store,
      input(entry.id, "in"),
      "store",
      biz,
    ))!;
    const b = (await saveClockPhoto(
      repo,
      store,
      input(entry.id, "out"),
      "store",
      biz,
    ))!;
    const keep = (await saveClockPhoto(
      repo,
      store,
      input(fresh.entry.id, "in"),
      "store",
      biz,
    ))!;
    expect(store.objects.size).toBe(3);

    // One object refuses to go (the first expired one, `a`): its row must
    // survive for the next sweep while `b` is fully removed.
    store.failNext("delete");
    const purged = await purgeExpiredClockPhotos(repo, store, NOW);
    expect(purged).toBe(1);
    const remaining = await db
      .select({ id: clockPhotos.id })
      .from(clockPhotos)
      .where(inArray(clockPhotos.id, [a.id, b.id, keep.id]));
    expect(remaining.map((r) => r.id).sort()).toEqual([a.id, keep.id].sort());
    expect(store.objects.size).toBe(2);
    expect(store.objects.has((await rowOf(a.id)).storageKey!)).toBe(true);

    // The next sweep (through the job's per-business function) finishes it.
    expect(await purgePhotosForBusiness({ id: biz }, NOW, store)).toBe(1);
    expect(store.objects.size).toBe(1);
    expect(await rowOf(keep.id)).toBeTruthy();
    // The other tenant's photos are untouched by this business's sweep.
    const foreign = await entryFor(other, old, "foreign-retention");
    const f = (await saveClockPhoto(
      foreign.repo,
      store,
      input(foreign.entry.id, "in"),
      "store",
      other,
    ))!;
    expect(await purgePhotosForBusiness({ id: biz }, NOW, store)).toBe(0);
    expect(await rowOf(f.id)).toBeTruthy();
    expect(store.objects.size).toBe(2);
  });

  it("backfills database-only photos resumably, then clears bytes only after verifying the object", async () => {
    const store = new InMemoryBlobStore();
    // Its own business: the run is scoped to it (the shared test database
    // holds other files' photos, which must never be touched from here).
    const { repo, entry } = await entryFor(bizBackfill, NOW, "backfill");
    const scoped = { businessIds: [bizBackfill] };
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const saved = (await saveClockPhoto(
        repo,
        store,
        {
          timesheetEntryId: entry.id,
          kind: i % 2 ? "out" : "in",
          mimeType: "image/jpeg",
          data: Buffer.concat([jpeg, Buffer.from([i])]),
        },
        "database",
        bizBackfill,
      ))!;
      ids.push(saved.id);
    }
    const mine = () =>
      [...store.objects.keys()].filter((k) => ids.some((id) => k.includes(id)))
        .length;

    // A limited first run uploads some; a second run picks up the rest and
    // never re-uploads what is done.
    const first = await backfillClockPhotos(store, {
      ...scoped,
      batchSize: 2,
      limit: 2,
    });
    expect(first.uploaded).toBe(2);
    expect(first.failed).toBe(0);
    expect(mine()).toBe(2);
    const second = await backfillClockPhotos(store, {
      ...scoped,
      batchSize: 2,
    });
    expect(second.uploaded).toBe(3);
    expect(mine()).toBe(5);
    const third = await backfillClockPhotos(store, {
      ...scoped,
      batchSize: 50,
    });
    expect(third.uploaded).toBe(0);
    expect(third.scanned).toBe(0);
    // An empty scope is a no-op.
    expect(
      (await backfillClockPhotos(store, { businessIds: [] })).scanned,
    ).toBe(0);
    for (const id of ids) {
      const row = await rowOf(id);
      expect(row.storageKey).toBeTruthy();
      expect(row.imageData).not.toBeNull(); // bytes kept until --clear-bytes
      expect(row.contentLength).toBe(jpeg.length + 1);
    }

    // Clearing verifies each object: one deleted behind our back is kept.
    const victim = await rowOf(ids[0]!);
    store.objects.delete(victim.storageKey!);
    const dry = await backfillClockPhotos(store, {
      ...scoped,
      clearBytes: true,
      dryRun: true,
    });
    expect(dry.cleared).toBe(0);
    expect(dry.skipped).toBe(5);
    const cleared = await backfillClockPhotos(store, {
      ...scoped,
      clearBytes: true,
    });
    expect(cleared.failed).toBe(0);
    expect(cleared.cleared).toBe(4);
    expect((await rowOf(ids[0]!)).imageData).not.toBeNull();
    for (const id of ids.slice(1)) {
      expect((await rowOf(id)).imageData).toBeNull();
    }
    // A store outage mid-run is counted, not fatal, and the row stays eligible.
    store.failNext("head");
    const again = await backfillClockPhotos(store, {
      ...scoped,
      clearBytes: true,
    });
    expect(again.cleared).toBe(0);
    expect(again.failed).toBe(1);
    expect((await rowOf(ids[0]!)).imageData).not.toBeNull();
    expect(await readClockPhoto(repo, store, ids[1]!)).not.toBeNull();
  });
});
