import { and, asc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { clockPhotos } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { createTenantRepo } from "@/lib/tenant/repository";
import { checksumOf, clockPhotoKey } from "@/lib/clock-photo-storage";
import type { BlobStore } from "./store";

/**
 * Resumable backfill of existing clock-in photos into the object store
 * (PERF-06, expand/contract step 2). Two phases, each idempotent and keyset
 * paginated so a crash or a `--limit` just stops early and the next run
 * carries on from wherever the filters still match:
 *
 *   upload  — every photo with bytes and no `storage_key`: put the object,
 *             then record key + size + checksum on the row (bytes KEPT).
 *   clear   — only with `clearBytes`: every photo with a key AND bytes: HEAD
 *             the object, and when it exists with the recorded size, drop
 *             the database copy. The contract migration (dropping the
 *             column) runs by hand after this reports nothing left.
 *
 * Scans read across tenants (like the daily dispatcher); every WRITE goes
 * through that photo's own tenant repo, so scoping is unchanged. A failed
 * row is counted and skipped — it stays eligible for the next run.
 */

export interface BackfillOptions {
  database?: Db;
  batchSize?: number;
  /** Stop after this many rows were scanned (both phases together). */
  limit?: number;
  clearBytes?: boolean;
  dryRun?: boolean;
  /**
   * Restrict the run to these businesses — one tenant at a time by hand, or
   * a test on the shared database. Production runs scan everything.
   */
  businessIds?: string[];
}

export interface BackfillResult {
  scanned: number;
  uploaded: number;
  cleared: number;
  skipped: number;
  failed: number;
}

type Cursor = { createdAt: Date; id: string } | null;

/** Keyset predicate: strictly after the cursor in (created_at, id) order. */
function after(cursor: Cursor) {
  return cursor
    ? or(
        gt(clockPhotos.createdAt, cursor.createdAt),
        and(
          eq(clockPhotos.createdAt, cursor.createdAt),
          gt(clockPhotos.id, cursor.id),
        ),
      )
    : undefined;
}

type UploadRow = {
  id: string;
  businessId: string;
  timesheetEntryId: string;
  mimeType: string;
  imageData: Buffer | null;
  createdAt: Date;
};

type ClearRow = {
  id: string;
  businessId: string;
  storageKey: string | null;
  contentLength: number | null;
  checksum: string | null;
  createdAt: Date;
};

export async function backfillClockPhotos(
  store: BlobStore,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const database = opts.database ?? defaultDb;
  const batchSize = opts.batchSize ?? 50;
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const result: BackfillResult = {
    scanned: 0,
    uploaded: 0,
    cleared: 0,
    skipped: 0,
    failed: 0,
  };
  if (opts.businessIds && opts.businessIds.length === 0) return result;
  const scope = opts.businessIds
    ? inArray(clockPhotos.businessId, opts.businessIds)
    : undefined;

  // Phase 1 — upload.
  let cursor: Cursor = null;
  while (result.scanned < limit) {
    const page: UploadRow[] = await database
      .select({
        id: clockPhotos.id,
        businessId: clockPhotos.businessId,
        timesheetEntryId: clockPhotos.timesheetEntryId,
        mimeType: clockPhotos.mimeType,
        imageData: clockPhotos.imageData,
        createdAt: clockPhotos.createdAt,
      })
      .from(clockPhotos)
      .where(
        and(
          scope,
          isNull(clockPhotos.storageKey),
          isNotNull(clockPhotos.imageData),
          after(cursor),
        ),
      )
      .orderBy(asc(clockPhotos.createdAt), asc(clockPhotos.id))
      .limit(Math.min(batchSize, limit - result.scanned));
    if (page.length === 0) break;
    for (const row of page) {
      result.scanned++;
      const bytes = row.imageData!;
      const key = clockPhotoKey({
        businessId: row.businessId,
        timesheetEntryId: row.timesheetEntryId,
        photoId: row.id,
        mimeType: row.mimeType,
      });
      if (opts.dryRun) {
        result.skipped++;
        continue;
      }
      try {
        await store.put(key, bytes, { contentType: row.mimeType });
        const marked = await createTenantRepo(row.businessId).markPhotoStored(
          row.id,
          {
            storageKey: key,
            contentLength: bytes.length,
            checksum: checksumOf(bytes),
          },
        );
        if (marked) result.uploaded++;
        else result.skipped++; // stored by someone else meanwhile
      } catch (err) {
        result.failed++;
        logger.error(
          { err, photoId: row.id, businessId: row.businessId },
          "Clock photo backfill upload failed",
        );
      }
    }
    const last = page[page.length - 1]!;
    cursor = { createdAt: last.createdAt, id: last.id };
    if (page.length < batchSize) break;
  }

  // Phase 2 — clear the database copy once the object is verified.
  if (opts.clearBytes) {
    cursor = null;
    while (result.scanned < limit) {
      const page: ClearRow[] = await database
        .select({
          id: clockPhotos.id,
          businessId: clockPhotos.businessId,
          storageKey: clockPhotos.storageKey,
          contentLength: clockPhotos.contentLength,
          checksum: clockPhotos.checksum,
          createdAt: clockPhotos.createdAt,
        })
        .from(clockPhotos)
        .where(
          and(
            scope,
            isNotNull(clockPhotos.storageKey),
            isNotNull(clockPhotos.imageData),
            after(cursor),
          ),
        )
        .orderBy(asc(clockPhotos.createdAt), asc(clockPhotos.id))
        .limit(Math.min(batchSize, limit - result.scanned));
      if (page.length === 0) break;
      for (const row of page) {
        result.scanned++;
        if (opts.dryRun || !row.storageKey || !row.checksum) {
          result.skipped++;
          continue;
        }
        try {
          const head = await store.head(row.storageKey);
          if (!head || head.contentLength !== row.contentLength) {
            result.skipped++;
            logger.warn(
              {
                photoId: row.id,
                storageKey: row.storageKey,
                expected: row.contentLength,
                found: head?.contentLength ?? null,
              },
              "Clock photo object missing or wrong size; database copy kept",
            );
            continue;
          }
          const cleared = await createTenantRepo(
            row.businessId,
          ).clearPhotoBytes(row.id, row.checksum);
          if (cleared) result.cleared++;
          else result.skipped++;
        } catch (err) {
          result.failed++;
          logger.error(
            { err, photoId: row.id, businessId: row.businessId },
            "Clock photo backfill verify/clear failed",
          );
        }
      }
      const last = page[page.length - 1]!;
      cursor = { createdAt: last.createdAt, id: last.id };
      if (page.length < batchSize) break;
    }
  }

  logger.info(result, "Clock photo backfill run complete");
  return result;
}
