/**
 * Move existing clock-in photos from Postgres into the object store
 * (PERF-06, expand/contract step 2). Resumable and idempotent — run it as
 * often as you like; a `--limit` just stops early and the next run carries
 * on. Then, once every photo is stored, `--clear-bytes` drops the database
 * copies after verifying each object, and the column can be dropped by hand
 * (docs/operations.md, section 5.3).
 *
 *   npm run photos:backfill -- [--batch 50] [--limit N] [--dry-run] [--business <id>]
 *   npm run photos:backfill -- --clear-bytes [--limit N] [--business <id>]
 *
 * Needs BLOB_S3_* (fails closed without them) and the DIRECT DATABASE_URL.
 * Exit code 1 when any row failed, so a cron can alert on it.
 */
import { db } from "../src/lib/db";
import { blobStore } from "../src/lib/blob/s3";
import { backfillClockPhotos } from "../src/lib/blob/backfill";

function intOption(name: string): number | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const n = Number(process.argv[idx + 1]);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a whole number >= 1`);
  }
  return n;
}

function businessOption(): string[] | undefined {
  const idx = process.argv.indexOf("--business");
  if (idx === -1) return undefined;
  const id = process.argv[idx + 1] ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("--business must be a business uuid");
  }
  return [id];
}

async function main() {
  const store = blobStore();
  if (!store) {
    process.stderr.write(
      "Object storage is not configured (BLOB_S3_ENDPOINT, BLOB_S3_REGION, BLOB_S3_BUCKET, BLOB_S3_ACCESS_KEY_ID, BLOB_S3_SECRET_ACCESS_KEY). Nothing to do.\n",
    );
    process.exitCode = 2;
    return;
  }
  const result = await backfillClockPhotos(store, {
    batchSize: intOption("--batch"),
    limit: intOption("--limit"),
    clearBytes: process.argv.includes("--clear-bytes"),
    dryRun: process.argv.includes("--dry-run"),
    businessIds: businessOption(),
  });
  process.stdout.write(
    `scanned ${result.scanned}, uploaded ${result.uploaded}, cleared ${result.cleared}, skipped ${result.skipped}, failed ${result.failed}\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
