import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  EMPTY_PAYLOAD_HASH,
  encodeKeyPath,
  sha256Hex,
  signRequest,
} from "./sigv4";
import {
  BlobStoreError,
  assertBlobKey,
  type BlobHead,
  type BlobObject,
  type BlobStore,
} from "./store";

/**
 * S3-compatible object store over raw `fetch` + SigV4 (PERF-06): AWS S3,
 * Cloudflare R2, MinIO, or Zale Storage when it exists. No SDK — the four
 * verbs below are the whole surface, and the signing maths is pinned to
 * AWS's test vectors. Configured by `BLOB_S3_*`; FAIL CLOSED: with any of
 * the five required variables missing, `blobStore()` is null and photos keep
 * going to the database exactly as before.
 */

export interface S3Config {
  /** `https://s3.ap-southeast-2.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com`, … */
  endpoint: string;
  /** `ap-southeast-2` for AWS; `auto` for R2. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * `https://endpoint/bucket/key` (true — works everywhere, the default) or
   * `https://bucket.endpoint/key` (false — AWS virtual-hosted style).
   */
  forcePathStyle: boolean;
}

export function parseS3Config(
  vars: Record<string, string | undefined>,
): S3Config | null {
  const endpoint = vars.BLOB_S3_ENDPOINT?.trim();
  const region = vars.BLOB_S3_REGION?.trim();
  const bucket = vars.BLOB_S3_BUCKET?.trim();
  const accessKeyId = vars.BLOB_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = vars.BLOB_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  const pathStyle = (vars.BLOB_S3_FORCE_PATH_STYLE ?? "true")
    .trim()
    .toLowerCase();
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: !["false", "0", "no"].includes(pathStyle),
  };
}

export const S3_REQUEST_TIMEOUT_MS = 15_000;

export class S3BlobStore implements BlobStore {
  readonly kind = "s3";
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly config: S3Config,
    deps: { fetchImpl?: typeof fetch; now?: () => Date } = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  /** The URL an object lives at, plus the host + path the signature covers. */
  objectLocation(key: string): { url: string; host: string; path: string } {
    assertBlobKey(key);
    const endpoint = new URL(this.config.endpoint);
    const encodedKey = encodeKeyPath(key);
    if (this.config.forcePathStyle) {
      const path = `/${this.config.bucket}${encodedKey}`;
      return { url: `${endpoint.origin}${path}`, host: endpoint.host, path };
    }
    const host = `${this.config.bucket}.${endpoint.host}`;
    return {
      url: `${endpoint.protocol}//${host}${encodedKey}`,
      host,
      path: encodedKey,
    };
  }

  private async request(
    operation: BlobStoreError["operation"],
    key: string,
    method: "PUT" | "GET" | "HEAD" | "DELETE",
    body?: Buffer,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { url, host, path } = this.objectLocation(key);
    const signed = signRequest(
      {
        method,
        host,
        path,
        headers: extraHeaders,
        payloadHash: body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH,
        now: this.now(),
      },
      {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
        region: this.config.region,
        service: "s3",
      },
    );
    // `host` is set by fetch itself; sending it explicitly is rejected by
    // some runtimes. Everything else signed travels verbatim.
    const { host: _host, ...headers } = signed.headers;
    void _host;
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BlobStoreError(operation, key, "request failed", null, {
        cause: err,
      });
    }
  }

  async put(key: string, body: Buffer, opts: { contentType: string }) {
    const res = await this.request("put", key, "PUT", body, {
      "content-type": opts.contentType,
      "content-length": String(body.length),
    });
    if (!res.ok) throw await failure("put", key, res);
  }

  async get(key: string): Promise<BlobObject | null> {
    const res = await this.request("get", key, "GET");
    if (res.status === 404) return null;
    if (!res.ok) throw await failure("get", key, res);
    const bytes = Buffer.from(await res.arrayBuffer());
    return {
      body: bytes,
      contentType: res.headers.get("content-type"),
      contentLength: bytes.length,
    };
  }

  async head(key: string): Promise<BlobHead | null> {
    const res = await this.request("head", key, "HEAD");
    if (res.status === 404) return null;
    if (!res.ok) throw await failure("head", key, res);
    const length = Number(res.headers.get("content-length") ?? "");
    return {
      contentLength: Number.isFinite(length) ? length : 0,
      contentType: res.headers.get("content-type"),
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.request("delete", key, "DELETE");
    if (res.status === 404 || res.ok) return;
    throw await failure("delete", key, res);
  }
}

async function failure(
  operation: BlobStoreError["operation"],
  key: string,
  res: Response,
): Promise<BlobStoreError> {
  // S3 error bodies are small XML documents; keep the code, never the bytes.
  let detail = "";
  try {
    const text = await res.text();
    detail = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
  } catch {
    // The status is enough.
  }
  return new BlobStoreError(
    operation,
    key,
    `HTTP ${res.status}${detail ? ` ${detail}` : ""}`,
    res.status,
  );
}

let cached: BlobStore | null | undefined;

function blobVars(): Record<string, string | undefined> {
  return {
    BLOB_S3_ENDPOINT: env.BLOB_S3_ENDPOINT,
    BLOB_S3_REGION: env.BLOB_S3_REGION,
    BLOB_S3_BUCKET: env.BLOB_S3_BUCKET,
    BLOB_S3_ACCESS_KEY_ID: env.BLOB_S3_ACCESS_KEY_ID,
    BLOB_S3_SECRET_ACCESS_KEY: env.BLOB_S3_SECRET_ACCESS_KEY,
    BLOB_S3_FORCE_PATH_STYLE: env.BLOB_S3_FORCE_PATH_STYLE,
  };
}

/** Whether `BLOB_S3_*` is fully configured (fail closed otherwise). */
export function isBlobStoreConfigured(): boolean {
  return parseS3Config(blobVars()) !== null;
}

/**
 * The process-wide store, or null when object storage is not configured —
 * callers then keep bytes in the database (the pre-PERF-06 behaviour).
 */
export function blobStore(): BlobStore | null {
  if (cached !== undefined) return cached;
  const config = parseS3Config(blobVars());
  if (!config) {
    cached = null;
    return null;
  }
  logger.info(
    {
      endpoint: config.endpoint,
      bucket: config.bucket,
      pathStyle: config.forcePathStyle,
    },
    "Object storage configured",
  );
  cached = new S3BlobStore(config);
  return cached;
}

/** Tests only: replace or clear the process-wide store. */
export function setBlobStoreForTests(store: BlobStore | null | undefined) {
  cached = store;
}
