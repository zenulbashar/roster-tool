import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { reportError } from "@/lib/error-reporting";
import { sha256Hex } from "@/lib/blob/sigv4";
import type { BlobStore } from "@/lib/blob/store";
import type { TenantRepo } from "@/lib/tenant/repository";

/**
 * Where a clock-in photo's bytes live (PERF-06).
 *
 * Before: `clock_photo.image_data bytea` in the primary database — every
 * photo went through the WAL, every backup and every restore. Now the row
 * is the FACT (who, which entry, in/out, when, size, checksum) and the bytes
 * belong in the object store under `storage_key`, exactly how
 * `staff_document` treats Google Drive. The transition is expand/contract:
 *
 *   - `database` — no store configured: bytes in Postgres, as before.
 *   - `dual`     — store configured, flag off: bytes to the store AND the
 *                  database, so a rollback of the code keeps working.
 *   - `store`    — store configured, `photo_blob_only` flag on: bytes to the
 *                  store only. The backfill script moves history.
 *
 * Invariants, all tested: a store outage NEVER blocks clocking (the bytes
 * fall back to the database and the failure is reported); a read prefers the
 * store and falls back to the database copy; objects are deleted BEFORE
 * their rows so a failed delete is retried by the next sweep, never orphaned
 * silently. Bytes are never logged.
 */

export const CLOCK_PHOTO_KEY_PREFIX = "clock-photos";

export type PhotoWriteMode = "database" | "dual" | "store";

export function resolvePhotoWriteMode(input: {
  storeConfigured: boolean;
  storeOnly: boolean;
}): PhotoWriteMode {
  if (!input.storeConfigured) return "database";
  return input.storeOnly ? "store" : "dual";
}

export function extensionFor(mimeType: string): "jpg" | "png" | "bin" {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    default:
      return "bin";
  }
}

/** `clock-photos/<business>/<entry>/<photo>.<ext>` — tenant-first so a bucket listing groups by tenant. */
export function clockPhotoKey(p: {
  businessId: string;
  timesheetEntryId: string;
  photoId: string;
  mimeType: string;
}): string {
  return `${CLOCK_PHOTO_KEY_PREFIX}/${p.businessId}/${p.timesheetEntryId}/${p.photoId}.${extensionFor(p.mimeType)}`;
}

export function checksumOf(bytes: Buffer): string {
  return sha256Hex(bytes);
}

type PhotoRepo = Pick<
  TenantRepo,
  "addClockPhoto" | "getPhoto" | "listExpiredPhotos" | "deletePhotosByIds"
>;

export interface SaveClockPhotoInput {
  timesheetEntryId: string;
  kind: "in" | "out";
  mimeType: string;
  data: Buffer;
}

/**
 * Persist a captured photo per `mode`. Returns the photo id and whether the
 * bytes reached the store; null when the entry isn't this business's (the
 * uploaded object, if any, is removed again so nothing dangles).
 */
export async function saveClockPhoto(
  repo: PhotoRepo,
  store: BlobStore | null,
  input: SaveClockPhotoInput,
  mode: PhotoWriteMode,
  businessId: string,
): Promise<{ id: string; stored: boolean } | null> {
  const id = randomUUID();
  const key = clockPhotoKey({
    businessId,
    timesheetEntryId: input.timesheetEntryId,
    photoId: id,
    mimeType: input.mimeType,
  });
  let stored = false;
  if (mode !== "database" && store) {
    try {
      await store.put(key, input.data, { contentType: input.mimeType });
      stored = true;
    } catch (err) {
      // The photo is best-effort evidence; the clock action must succeed.
      // Keep the bytes in the database this once and make the outage visible.
      await reportError({
        error: err,
        tags: { source: "clock-photo", event: "put", store: store.kind },
      });
    }
  }
  const keepBytes = mode !== "store" || !stored;
  const row = await repo.addClockPhoto({
    id,
    timesheetEntryId: input.timesheetEntryId,
    kind: input.kind,
    mimeType: input.mimeType,
    imageData: keepBytes ? input.data : null,
    storageKey: stored ? key : null,
    contentLength: stored ? input.data.length : null,
    checksum: stored ? checksumOf(input.data) : null,
  });
  if (!row) {
    if (stored && store) await deleteClockPhotoObjects(store, [key]);
    return null;
  }
  return { id: row.id, stored };
}

/**
 * The bytes for one photo: from the store when the row points there (and
 * the store answers), else the database copy, else null. A store failure is
 * logged and falls back — the owner still sees the photo when a copy exists.
 */
export async function readClockPhoto(
  repo: PhotoRepo,
  store: BlobStore | null,
  id: string,
): Promise<{ mimeType: string; body: Buffer } | null> {
  const row = await repo.getPhoto(id);
  if (!row) return null;
  if (row.storageKey) {
    if (store) {
      try {
        const obj = await store.get(row.storageKey);
        if (obj) return { mimeType: row.mimeType, body: obj.body };
        logger.warn(
          { photoId: id, storageKey: row.storageKey },
          "Clock photo object missing from the store",
        );
      } catch (err) {
        logger.error(
          { err, photoId: id },
          "Clock photo read from the store failed; falling back",
        );
      }
    } else {
      logger.warn(
        { photoId: id },
        "Clock photo is in object storage but no store is configured",
      );
    }
  }
  if (row.imageData) return { mimeType: row.mimeType, body: row.imageData };
  return null;
}

/** Best-effort object deletion, one key at a time; never throws. */
export async function deleteClockPhotoObjects(
  store: BlobStore,
  keys: string[],
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await store.delete(key);
      deleted.push(key);
    } catch (err) {
      failed.push(key);
      logger.error(
        { err, storageKey: key },
        "Clock photo object delete failed",
      );
    }
  }
  return { deleted, failed };
}

/**
 * The retention sweep for one business: objects first, then rows — a row
 * whose object could not be deleted is KEPT so the next daily sweep retries
 * it (never a silent orphan). With no store configured the rows go anyway
 * (the objects belong to a store we no longer talk to; a bucket lifecycle
 * rule is the backstop — docs/operations.md). Returns rows removed.
 */
export async function purgeExpiredClockPhotos(
  repo: PhotoRepo,
  store: BlobStore | null,
  now: Date = new Date(),
): Promise<number> {
  const expired = await repo.listExpiredPhotos(now);
  if (expired.length === 0) return 0;
  const keys = expired.flatMap((p) => (p.storageKey ? [p.storageKey] : []));
  let failed = new Set<string>();
  if (store && keys.length > 0) {
    failed = new Set((await deleteClockPhotoObjects(store, keys)).failed);
  } else if (keys.length > 0) {
    logger.warn(
      { count: keys.length },
      "Expired clock photos reference object storage but no store is configured; deleting rows only",
    );
  }
  const deletable = expired
    .filter((p) => !p.storageKey || !failed.has(p.storageKey))
    .map((p) => p.id);
  return repo.deletePhotosByIds(deletable);
}
