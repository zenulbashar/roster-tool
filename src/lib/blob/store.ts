/**
 * Object storage for binary blobs (PERF-06).
 *
 * The database is the system of record for FACTS; bytes (today: clock-in
 * photos) belong in an object store, with the row holding a `storage_key` +
 * size + checksum — exactly how `staff_document` already treats Google
 * Drive. `BlobStore` is the narrow seam: an S3-compatible implementation for
 * production (`./s3.ts`, raw fetch + SigV4) and an in-memory one for tests.
 * Callers never see provider types, never log bytes, and treat a store
 * failure as non-fatal for the user action it decorates (a missing photo
 * never blocks clocking).
 */

export interface BlobObject {
  body: Buffer;
  contentType: string | null;
  contentLength: number;
}

export interface BlobHead {
  contentLength: number;
  contentType: string | null;
}

export interface BlobStore {
  /** `s3` | `memory` — for logs and the admin console, never for logic. */
  readonly kind: string;
  /** Create or replace. */
  put(key: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  /** The object, or null when it does not exist. */
  get(key: string): Promise<BlobObject | null>;
  /** Existence + size without the bytes, or null when absent. */
  head(key: string): Promise<BlobHead | null>;
  /** Idempotent: deleting an absent key succeeds. */
  delete(key: string): Promise<void>;
}

export class BlobStoreError extends Error {
  readonly operation: "put" | "get" | "head" | "delete";
  readonly key: string;
  readonly status: number | null;
  constructor(
    operation: BlobStoreError["operation"],
    key: string,
    message: string,
    status: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(`blob ${operation} ${key}: ${message}`, options);
    this.name = "BlobStoreError";
    this.operation = operation;
    this.key = key;
    this.status = status;
  }
}

/**
 * Keys are built by this codebase from ids and a fixed prefix, so a strict
 * grammar costs nothing and rules out path tricks at the boundary: relative
 * segments, leading slashes, whitespace, control characters, or anything
 * outside `[A-Za-z0-9/_.-]`.
 */
export const MAX_BLOB_KEY_LENGTH = 512;
const KEY_RE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

export function isValidBlobKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_BLOB_KEY_LENGTH) return false;
  if (!KEY_RE.test(key)) return false;
  return !key.split("/").some((seg) => seg === "." || seg === "..");
}

export function assertBlobKey(key: string): void {
  if (!isValidBlobKey(key)) throw new Error(`Invalid blob key: ${key}`);
}

/**
 * In-memory store for tests and local development without credentials.
 * `failNext` makes the next matching operation throw, so callers' "the
 * store is down" paths can be exercised deterministically.
 */
export class InMemoryBlobStore implements BlobStore {
  readonly kind = "memory";
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  private failures: Array<BlobStoreError["operation"] | "any"> = [];

  failNext(operation: BlobStoreError["operation"] | "any" = "any"): void {
    this.failures.push(operation);
  }

  private maybeFail(operation: BlobStoreError["operation"], key: string) {
    const idx = this.failures.findIndex((f) => f === "any" || f === operation);
    if (idx === -1) return;
    this.failures.splice(idx, 1);
    throw new BlobStoreError(operation, key, "simulated outage", 503);
  }

  async put(key: string, body: Buffer, opts: { contentType: string }) {
    assertBlobKey(key);
    this.maybeFail("put", key);
    this.objects.set(key, {
      body: Buffer.from(body),
      contentType: opts.contentType,
    });
  }

  async get(key: string): Promise<BlobObject | null> {
    assertBlobKey(key);
    this.maybeFail("get", key);
    const hit = this.objects.get(key);
    return hit
      ? {
          body: Buffer.from(hit.body),
          contentType: hit.contentType,
          contentLength: hit.body.length,
        }
      : null;
  }

  async head(key: string): Promise<BlobHead | null> {
    assertBlobKey(key);
    this.maybeFail("head", key);
    const hit = this.objects.get(key);
    return hit
      ? { contentLength: hit.body.length, contentType: hit.contentType }
      : null;
  }

  async delete(key: string): Promise<void> {
    assertBlobKey(key);
    this.maybeFail("delete", key);
    this.objects.delete(key);
  }
}
