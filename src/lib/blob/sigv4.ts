import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 — PURE, no I/O, no SDK.
 *
 * The blob store talks to any S3-compatible service (AWS S3, Cloudflare R2,
 * MinIO, …) over raw `fetch` (PERF-06), mirroring the Xero and Drive
 * clients: the network surface is a handful of verbs we can read in one
 * screen, and the signing maths lives here where it can be pinned to AWS's
 * published test vectors (`tests/sigv4.test.ts`).
 *
 * Reference: "Signature Version 4 signing process" and the S3 API's
 * "Authenticating Requests: Using the Authorization Header". S3 differs from
 * other AWS services in ONE place — the canonical URI is encoded exactly
 * once (no double encoding) — which is why callers hand this module an
 * already-encoded path and it is used verbatim.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** `s3` for object storage. */
  service: string;
}

export interface SigV4Input {
  method: string;
  /** Host header value, e.g. `examplebucket.s3.amazonaws.com`. */
  host: string;
  /** Already-URI-encoded absolute path, e.g. `/test%24file.text`. */
  path: string;
  /** Raw query pairs (unencoded); sorted + encoded here. */
  query?: Array<[string, string]>;
  /** Extra headers to sign (`content-type`, `range`, `x-amz-*`…). */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the payload (`EMPTY_PAYLOAD_HASH` for none). */
  payloadHash: string;
  /** The request instant (its `x-amz-date` is derived here). */
  now: Date;
}

export interface SignedRequest {
  /** Every header to send, including host, x-amz-date, x-amz-content-sha256 and Authorization. */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** AWS `UriEncode`: RFC 3986 unreserved characters pass, everything else is `%XX`. */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key into the request path, segment by segment (`/` kept). */
export function encodeKeyPath(key: string): string {
  return `/${key.split("/").map(uriEncode).join("/")}`;
}

/** `YYYYMMDD'T'HHMMSS'Z'` and the `YYYYMMDD` credential-scope date. */
export function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString(); // 2013-05-24T00:00:00.000Z
  const compact = iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amzDate: compact, dateStamp: compact.slice(0, 8) };
}

export function canonicalQueryString(query: Array<[string, string]>): string {
  return query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([ka, va], [kb, vb]) =>
      ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Lower-cased, trimmed, sorted; values with runs of spaces collapsed. */
export function canonicalHeaders(headers: Record<string, string>): {
  canonical: string;
  signedHeaders: string;
} {
  const entries = Object.entries(headers)
    .map(
      ([k, v]) =>
        [k.toLowerCase().trim(), v.trim().replace(/\s+/g, " ")] as const,
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    canonical: entries.map(([k, v]) => `${k}:${v}\n`).join(""),
    signedHeaders: entries.map(([k]) => k).join(";"),
  };
}

export function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Sign one request. Returns the complete header set to send; the caller
 * must send EXACTLY these headers (any extra unsigned header is fine, but a
 * signed one must not change).
 */
export function signRequest(
  input: SigV4Input,
  creds: SigV4Credentials,
): SignedRequest {
  const { amzDate: date, dateStamp } = amzDate(input.now);
  const headers: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": date,
  };
  const { canonical, signedHeaders } = canonicalHeaders(headers);
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQueryString(input.query ?? []),
    canonical,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    signingKey(creds.secretAccessKey, dateStamp, creds.region, creds.service),
    stringToSign,
  ).toString("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: { ...headers, authorization },
    canonicalRequest,
    stringToSign,
    signature,
  };
}
