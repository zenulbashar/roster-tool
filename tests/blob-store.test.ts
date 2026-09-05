import { describe, it, expect, vi } from "vitest";
import {
  BlobStoreError,
  InMemoryBlobStore,
  assertBlobKey,
  isValidBlobKey,
} from "@/lib/blob/store";
import { S3BlobStore, parseS3Config } from "@/lib/blob/s3";

/**
 * PERF-06 — the object-store seam. The S3 implementation is exercised over a
 * fake `fetch` that records what it was asked to send: URL shape (path-style
 * and virtual-hosted), the signed headers, payload hashing, and how each
 * status maps to a result (404 → null / idempotent delete; anything else a
 * typed error carrying the status and S3's error code, never the body).
 */
const CONFIG = {
  endpoint: "https://s3.ap-southeast-2.amazonaws.com",
  region: "ap-southeast-2",
  bucket: "roster-photos",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
  forcePathStyle: true,
};

type Sent = { url: string; method: string; headers: Record<string, string> };

function fakeFetch(respond: (sent: Sent, body?: Uint8Array) => Response) {
  const calls: Sent[] = [];
  const impl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const sent: Sent = {
        url: String(url),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), v],
          ),
        ),
      };
      calls.push(sent);
      return respond(sent, init?.body as Uint8Array | undefined);
    },
  );
  return { calls, impl: impl as unknown as typeof fetch };
}

describe("blob keys", () => {
  it("accepts the keys this codebase builds and rejects path tricks", () => {
    expect(isValidBlobKey("clock-photos/biz/entry/photo.jpg")).toBe(true);
    expect(isValidBlobKey("a_b-c.d")).toBe(true);
    for (const bad of [
      "",
      "/leading",
      "trailing/",
      "a//b",
      "a/../b",
      "./a",
      "a b",
      "a\nb",
      "a?x=1",
      "ünïcode",
      "x".repeat(513),
    ]) {
      expect(isValidBlobKey(bad), bad).toBe(false);
    }
    expect(() => assertBlobKey("../x")).toThrow(/Invalid blob key/);
  });
});

describe("InMemoryBlobStore", () => {
  it("round-trips, heads, deletes idempotently and can simulate an outage", async () => {
    const store = new InMemoryBlobStore();
    await store.put("k/1.jpg", Buffer.from("abc"), {
      contentType: "image/jpeg",
    });
    expect(await store.get("k/1.jpg")).toEqual({
      body: Buffer.from("abc"),
      contentType: "image/jpeg",
      contentLength: 3,
    });
    expect(await store.head("k/1.jpg")).toEqual({
      contentLength: 3,
      contentType: "image/jpeg",
    });
    expect(await store.get("k/missing")).toBeNull();
    await store.delete("k/1.jpg");
    await store.delete("k/1.jpg");
    expect(await store.head("k/1.jpg")).toBeNull();

    store.failNext("put");
    await expect(
      store.put("k/2.jpg", Buffer.from("x"), { contentType: "image/png" }),
    ).rejects.toBeInstanceOf(BlobStoreError);
    await store.put("k/2.jpg", Buffer.from("x"), { contentType: "image/png" });
    expect(store.objects.size).toBe(1);
  });
});

describe("parseS3Config", () => {
  it("fails closed unless every required variable is present and sane", () => {
    const full = {
      BLOB_S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com/",
      BLOB_S3_REGION: "auto",
      BLOB_S3_BUCKET: "roster-photos",
      BLOB_S3_ACCESS_KEY_ID: "id",
      BLOB_S3_SECRET_ACCESS_KEY: "secret",
    };
    expect(parseS3Config(full)).toEqual({
      endpoint: "https://acc.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "roster-photos",
      accessKeyId: "id",
      secretAccessKey: "secret",
      forcePathStyle: true,
    });
    expect(
      parseS3Config({ ...full, BLOB_S3_FORCE_PATH_STYLE: "false" })
        ?.forcePathStyle,
    ).toBe(false);
    for (const key of Object.keys(full)) {
      expect(parseS3Config({ ...full, [key]: "" }), key).toBeNull();
      expect(parseS3Config({ ...full, [key]: undefined }), key).toBeNull();
    }
    expect(
      parseS3Config({ ...full, BLOB_S3_ENDPOINT: "not a url" }),
    ).toBeNull();
    expect(parseS3Config({ ...full, BLOB_S3_ENDPOINT: "ftp://x" })).toBeNull();
    expect(parseS3Config({ ...full, BLOB_S3_BUCKET: "Bad Bucket" })).toBeNull();
    expect(parseS3Config({})).toBeNull();
  });
});

describe("S3BlobStore", () => {
  const now = () => new Date("2026-09-05T01:00:00Z");

  it("builds path-style and virtual-hosted URLs from the key", () => {
    const pathStyle = new S3BlobStore(CONFIG, { now });
    expect(pathStyle.objectLocation("clock-photos/a/b/c.jpg")).toEqual({
      url: "https://s3.ap-southeast-2.amazonaws.com/roster-photos/clock-photos/a/b/c.jpg",
      host: "s3.ap-southeast-2.amazonaws.com",
      path: "/roster-photos/clock-photos/a/b/c.jpg",
    });
    const vhost = new S3BlobStore(
      { ...CONFIG, forcePathStyle: false },
      { now },
    );
    expect(vhost.objectLocation("k.png")).toEqual({
      url: "https://roster-photos.s3.ap-southeast-2.amazonaws.com/k.png",
      host: "roster-photos.s3.ap-southeast-2.amazonaws.com",
      path: "/k.png",
    });
    expect(() => pathStyle.objectLocation("../etc")).toThrow();
  });

  it("PUT sends signed headers with the payload hash and content type", async () => {
    let received: Uint8Array | undefined;
    const { calls, impl } = fakeFetch((_sent, body) => {
      received = body;
      return new Response(null, { status: 200 });
    });
    const store = new S3BlobStore(CONFIG, { fetchImpl: impl, now });
    await store.put("p/1.jpg", Buffer.from("hello"), {
      contentType: "image/jpeg",
    });
    const sent = calls[0]!;
    expect(sent.method).toBe("PUT");
    expect(sent.url).toBe(
      "https://s3.ap-southeast-2.amazonaws.com/roster-photos/p/1.jpg",
    );
    expect(sent.headers["content-type"]).toBe("image/jpeg");
    expect(sent.headers["content-length"]).toBe("5");
    expect(sent.headers["x-amz-date"]).toBe("20260905T010000Z");
    expect(sent.headers["x-amz-content-sha256"]).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(sent.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260905\/ap-southeast-2\/s3\/aws4_request, SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(sent.headers.host).toBeUndefined(); // fetch sets it
    expect(Buffer.from(received!).toString()).toBe("hello");
  });

  it("GET returns the object, null on 404, and a typed error otherwise", async () => {
    const { impl } = fakeFetch((sent) => {
      if (sent.url.endsWith("/missing.jpg"))
        return new Response("<Error><Code>NoSuchKey</Code></Error>", {
          status: 404,
        });
      if (sent.url.endsWith("/denied.jpg"))
        return new Response("<Error><Code>AccessDenied</Code></Error>", {
          status: 403,
        });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    const store = new S3BlobStore(CONFIG, { fetchImpl: impl, now });
    expect(await store.get("p/ok.png")).toEqual({
      body: Buffer.from([1, 2, 3]),
      contentType: "image/png",
      contentLength: 3,
    });
    expect(await store.get("p/missing.jpg")).toBeNull();
    const err = await store.get("p/denied.jpg").catch((e) => e);
    expect(err).toBeInstanceOf(BlobStoreError);
    expect(err.status).toBe(403);
    expect(err.operation).toBe("get");
    expect(err.message).toContain("AccessDenied");
    expect(err.message).not.toContain("<Error>");
  });

  it("HEAD reports size, DELETE is idempotent, and a network failure is typed", async () => {
    const { calls, impl } = fakeFetch((sent) => {
      if (sent.method === "HEAD")
        return new Response(null, {
          status: 200,
          headers: { "content-length": "42", "content-type": "image/jpeg" },
        });
      if (sent.method === "DELETE")
        return new Response(null, {
          status: sent.url.endsWith("gone") ? 404 : 204,
        });
      return new Response(null, { status: 500 });
    });
    const store = new S3BlobStore(CONFIG, { fetchImpl: impl, now });
    expect(await store.head("p/x.jpg")).toEqual({
      contentLength: 42,
      contentType: "image/jpeg",
    });
    await store.delete("p/x.jpg");
    await store.delete("p/gone");
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "DELETE", "DELETE"]);

    const down = new S3BlobStore(CONFIG, {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      now,
    });
    const err = await down.head("p/x.jpg").catch((e) => e);
    expect(err).toBeInstanceOf(BlobStoreError);
    expect(err.status).toBeNull();
    expect(err.cause).toBeInstanceOf(TypeError);
  });
});
