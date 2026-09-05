import { describe, it, expect, vi } from "vitest";
import {
  parseDsn,
  envelopeUrl,
  scrubPii,
  scrubPath,
  parseStack,
  buildEvent,
  buildEnvelope,
  createErrorReporter,
  resolveRelease,
  resolveEnvironment,
} from "@/lib/error-reporting";

/**
 * OPS-01 item 3 — the dependency-free error reporter. Pins the DSN parsing,
 * the PII scrubbing that mirrors the pino redaction list (the audit's
 * required "PII scrubbing" test), the Sentry envelope shape, fail-closed
 * behaviour without a DSN, best-effort delivery, and the storm cap.
 */
const DSN = "https://abc123publickey@o4507.ingest.sentry.io/4509";

function quietLogger() {
  return { error: vi.fn(), warn: vi.fn() };
}

describe("DSN", () => {
  it("parses a hosted DSN and a self-hosted one with a path prefix", () => {
    expect(parseDsn(DSN)).toEqual({
      protocol: "https",
      publicKey: "abc123publickey",
      host: "o4507.ingest.sentry.io",
      path: "",
      projectId: "4509",
    });
    expect(envelopeUrl(parseDsn(DSN)!)).toBe(
      "https://o4507.ingest.sentry.io/api/4509/envelope/",
    );
    const relay = parseDsn("http://key@relay.internal:9000/sentry/12");
    expect(relay?.path).toBe("/sentry");
    expect(envelopeUrl(relay!)).toBe(
      "http://relay.internal:9000/sentry/api/12/envelope/",
    );
  });

  it("rejects malformed DSNs (no key, no project id, wrong scheme, junk)", () => {
    expect(parseDsn("")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("https://o1.ingest.sentry.io/4509")).toBeNull();
    expect(parseDsn("https://key@o1.ingest.sentry.io/")).toBeNull();
    expect(parseDsn("https://key@o1.ingest.sentry.io/notanumber")).toBeNull();
    expect(parseDsn("ftp://key@host/1")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
  });
});

describe("PII scrubbing", () => {
  it("removes emails, credentials, keyed secrets and opaque tokens", () => {
    const text =
      "Failed for sarah.k@cafe.test with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig token=abc123def456 and key " +
      "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lz9Xc8Vb7Nm6";
    const out = scrubPii(text);
    expect(out).not.toContain("sarah.k@cafe.test");
    expect(out).toContain("[email]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("abc123def456");
    expect(out).not.toContain("Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lz9Xc8Vb7Nm6");
    expect(out).toContain("[token]");
  });

  it("leaves ordinary messages alone", () => {
    expect(scrubPii('relation "shift" does not exist')).toBe(
      'relation "shift" does not exist',
    );
    expect(scrubPii("Cannot read properties of null (reading 'id')")).toBe(
      "Cannot read properties of null (reading 'id')",
    );
  });

  it("replaces the secret segment of every capability route and drops the query", () => {
    expect(scrubPath("/kiosk/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c")).toBe(
      "/kiosk/[token]",
    );
    expect(scrubPath("/me/tok/forms/abc?x=1")).toBe("/me/[token]/forms/abc");
    expect(scrubPath("/a/shortslug")).toBe("/a/[token]");
    expect(scrubPath("/r/abc")).toBe("/r/[token]");
    expect(scrubPath("/f/xyz")).toBe("/f/[token]");
    expect(scrubPath("/clock/abc")).toBe("/clock/[token]");
    expect(scrubPath("/app/staff?confirmDelete=1")).toBe("/app/staff");
    expect(scrubPath("/app/periods/1234/build")).toBe(
      "/app/periods/1234/build",
    );
  });
});

describe("event shape", () => {
  it("parses a V8 stack into oldest-first frames with in_app marked", () => {
    const stack = [
      "TypeError: boom",
      "    at handler (/srv/app/src/lib/x.ts:10:5)",
      "    at async run (/srv/app/node_modules/pg-boss/dist/manager.js:20:3)",
      "    at /srv/app/src/app/page.tsx:7:9",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n");
    const frames = parseStack(stack);
    expect(frames).toHaveLength(4);
    // Reversed: the innermost frame is last.
    expect(frames.at(-1)).toMatchObject({
      filename: "/srv/app/src/lib/x.ts",
      function: "handler",
      lineno: 10,
      colno: 5,
      in_app: true,
    });
    expect(frames.find((f) => f.filename.includes("pg-boss"))?.in_app).toBe(
      false,
    );
    expect(frames.find((f) => f.filename.startsWith("node:"))?.in_app).toBe(
      false,
    );
    expect(frames.find((f) => f.filename.endsWith("page.tsx"))?.function).toBe(
      "<anonymous>",
    );
    expect(parseStack(undefined)).toEqual([]);
  });

  it("builds a scrubbed event carrying digest, request id, path and tags", () => {
    const err = new Error("Mail to owner@cafe.test bounced");
    const now = new Date("2026-09-04T10:00:00Z");
    const event = buildEvent(
      {
        error: err,
        digest: "1234567890",
        requestId: "req-abcdef12",
        path: "/kiosk/secrettoken?x=1",
        method: "POST",
        tags: { source: "web", routeType: "action", skip: undefined },
      },
      { release: "abc123", environment: "production", now },
    );
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(event.timestamp).toBe(now.getTime() / 1000);
    expect(event.release).toBe("abc123");
    expect(event.environment).toBe("production");
    expect(event.transaction).toBe("/kiosk/[token]");
    expect(event.request).toEqual({ method: "POST" });
    expect(event.tags).toEqual({ source: "web", routeType: "action" });
    expect(event.extra).toEqual({
      digest: "1234567890",
      requestId: "req-abcdef12",
    });
    expect(event.exception.values[0]!.type).toBe("Error");
    expect(event.exception.values[0]!.value).toBe("Mail to [email] bounced");
    expect(
      event.exception.values[0]!.stacktrace?.frames.length,
    ).toBeGreaterThan(0);
  });

  it("describes non-Error throwables without crashing", () => {
    const opts = { release: null, environment: "test", now: new Date() };
    expect(
      buildEvent({ error: "just a string" }, opts).exception.values[0]!.value,
    ).toBe("just a string");
    expect(
      buildEvent({ error: { name: "Custom", message: "obj" } }, opts).exception
        .values[0],
    ).toMatchObject({ type: "Custom", value: "obj" });
    expect(buildEvent({ error: null }, opts).exception.values[0]!.value).toBe(
      "null",
    );
    expect(buildEvent({ error: 42 }, opts).release).toBeUndefined();
  });

  it("serialises the envelope as header, item header, payload", () => {
    const dsn = parseDsn(DSN)!;
    const event = buildEvent(
      { error: new Error("x") },
      { release: null, environment: "test", now: new Date(0) },
    );
    const lines = buildEnvelope(event, dsn, new Date(0)).split("\n");
    expect(lines).toHaveLength(4); // trailing newline
    expect(JSON.parse(lines[0]!)).toEqual({
      event_id: event.event_id,
      sent_at: "1970-01-01T00:00:00.000Z",
      dsn: DSN,
    });
    expect(JSON.parse(lines[1]!)).toEqual({
      type: "event",
      content_type: "application/json",
    });
    expect(JSON.parse(lines[2]!).event_id).toBe(event.event_id);
  });
});

describe("reporter", () => {
  it("fails closed without a DSN: logs, forwards nothing, never throws", async () => {
    const fetchImpl = vi.fn();
    const log = quietLogger();
    const reporter = createErrorReporter({
      dsn: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: log,
    });
    expect(reporter.forwarding).toBe(false);
    await reporter.report({ error: new Error("owner@x.test failed") });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.error.mock.calls[0]!;
    expect(msg).toBe("Unhandled error");
    expect(fields.errorMessage).toBe("[email] failed");
  });

  it("warns once about an invalid DSN and stays off", async () => {
    const log = quietLogger();
    const reporter = createErrorReporter({ dsn: "nonsense", logger: log });
    expect(reporter.forwarding).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("posts a scrubbed envelope to the DSN's envelope endpoint with the auth header", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const log = quietLogger();
    const reporter = createErrorReporter({
      dsn: DSN,
      environment: "production",
      release: "deadbeef",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: log,
      now: () => new Date("2026-09-04T10:00:00Z"),
    });
    expect(reporter.forwarding).toBe(true);
    await reporter.report({
      error: new Error("Push failed for jake@cafe.test"),
      digest: "digest-1",
      requestId: "req-00000001",
      path: "/me/verysecrettoken/forms/1",
      method: "POST",
      tags: { source: "web" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://o4507.ingest.sentry.io/api/4509/envelope/");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-sentry-envelope");
    expect(headers["X-Sentry-Auth"]).toContain("sentry_key=abc123publickey");
    const body = String(init.body);
    expect(body).not.toContain("jake@cafe.test");
    expect(body).not.toContain("verysecrettoken");
    expect(body).toContain("[email]");
    expect(body).toContain('"digest":"digest-1"');
    expect(body).toContain('"requestId":"req-00000001"');
    expect(body).toContain('"transaction":"/me/[token]/forms/1"');
    expect(body).toContain('"release":"deadbeef"');
    // The log line is written regardless of forwarding.
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("never throws when delivery fails or is rejected", async () => {
    const log = quietLogger();
    const failing = createErrorReporter({
      dsn: DSN,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      logger: log,
    });
    await expect(
      failing.report({ error: new Error("x") }),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Error report could not be delivered",
    );

    const rejected = createErrorReporter({
      dsn: DSN,
      fetchImpl: (async () =>
        new Response("", { status: 429 })) as unknown as typeof fetch,
      logger: log,
    });
    await rejected.report({ error: new Error("y") });
    expect(log.warn).toHaveBeenCalledWith(
      { status: 429 },
      "Error report was not accepted by the error tracker",
    );
  });

  it("caps forwarding per rolling minute but keeps logging every error", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const log = quietLogger();
    let t = new Date("2026-09-04T10:00:00Z").getTime();
    const reporter = createErrorReporter({
      dsn: DSN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: log,
      maxPerMinute: 3,
      now: () => new Date(t),
    });
    for (let i = 0; i < 5; i++) {
      await reporter.report({ error: new Error(`e${i}`) });
      t += 1000;
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenCalledTimes(5);
    // A minute later the window has rolled and forwarding resumes.
    t += 60_000;
    await reporter.report({ error: new Error("later") });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe("release + environment resolution", () => {
  it("prefers an explicit release, then the platform commit shas", () => {
    expect(resolveRelease({})).toBeNull();
    expect(resolveRelease({ VERCEL_GIT_COMMIT_SHA: "a".repeat(40) })).toBe(
      "a".repeat(40),
    );
    expect(
      resolveRelease({ APP_RELEASE: "v1.2.3", RAILWAY_GIT_COMMIT_SHA: "zzz" }),
    ).toBe("v1.2.3");
    expect(resolveRelease({ RAILWAY_GIT_COMMIT_SHA: "rrr" })).toBe("rrr");
  });

  it("labels the environment from the most specific source available", () => {
    expect(resolveEnvironment({})).toBe("development");
    expect(resolveEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(
      resolveEnvironment({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
    ).toBe("preview");
    expect(
      resolveEnvironment({ VERCEL_ENV: "preview", SENTRY_ENVIRONMENT: "qa" }),
    ).toBe("qa");
  });
});
