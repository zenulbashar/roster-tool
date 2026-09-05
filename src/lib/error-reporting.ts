import { env } from "@/lib/env";
import { logger as defaultLogger } from "@/lib/logger";

/**
 * Error reporting (OPS-01 item 3) — a dependency-free, Sentry-compatible
 * reporter over raw `fetch`, in the same spirit as the Xero client: the wire
 * protocol is small and documented, so a vendor SDK (and its build plugin,
 * source-map upload step and bundle weight) buys little here.
 *
 * Every report is ALSO written to the structured log, with the request id and
 * Next's error `digest`, so a support conversation can start from either the
 * reference code on the branded error page (`digest`) or a log line. When
 * `SENTRY_DSN` is unset the reporter FAILS CLOSED: it logs and forwards
 * nothing — the app never needs the vendor to boot.
 *
 * PII discipline mirrors the pino redaction list: the message, the stack, the
 * path and every tag pass through `scrubPii`/`scrubPath` before they leave the
 * process (emails, bearer/API tokens, capability-link segments). Never pass
 * request bodies, cookies or headers into a report.
 *
 * Reports are best-effort: a network failure is logged once and never thrown,
 * and an in-process rate limit stops an error storm from turning into a
 * second outage (the log keeps every line; only the forwarding is capped).
 */

/* ----- DSN ----- */

export interface ParsedDsn {
  protocol: "http" | "https";
  publicKey: string;
  host: string;
  /** Path prefix before /api (usually empty; self-hosted relays may set one). */
  path: string;
  projectId: string;
}

/** `https://<publicKey>@<host>[/<path>]/<projectId>` → parts, or null. */
export function parseDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.username || !url.hostname) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  return {
    protocol: url.protocol === "https:" ? "https" : "http",
    publicKey: url.username,
    host: url.host,
    path: segments.length ? `/${segments.join("/")}` : "",
    projectId,
  };
}

export function envelopeUrl(dsn: ParsedDsn): string {
  return `${dsn.protocol}://${dsn.host}${dsn.path}/api/${dsn.projectId}/envelope/`;
}

/* ----- PII scrubbing ----- */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEYED_SECRET =
  /\b(token|secret|password|pin|key|authorization|cookie)(=|:\s*|%3D)[^\s&;,"']+/gi;
const LONG_OPAQUE = /\b[A-Za-z0-9_-]{32,}\b/g;

/**
 * Remove what must never leave the process: email addresses, bearer/basic
 * credentials, `token=…`-style key/value pairs, and any opaque 32+ char token
 * (capability tokens, API keys, session ids — all longer than any word).
 */
export function scrubPii(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(BEARER, "$1 [token]")
    .replace(KEYED_SECRET, "$1$2[redacted]")
    .replace(LONG_OPAQUE, "[token]");
}

/**
 * Capability-link routes carry the secret IN THE PATH (`/kiosk/<token>`,
 * `/me/<token>`, `/a/<token>`, `/r/<slug>`, `/f/<slug>`, `/clock/<token>`):
 * the segment after the prefix is replaced wholesale, then the generic scrub
 * runs over the rest (a query string is dropped entirely).
 */
const CAPABILITY_PREFIXES = ["kiosk", "clock", "me", "a", "r", "f"];

export function scrubPath(path: string): string {
  const [pathname] = path.split("?");
  const parts = (pathname ?? "").split("/");
  for (let i = 1; i < parts.length - 1; i++) {
    if (CAPABILITY_PREFIXES.includes(parts[i]!) && parts[i + 1]) {
      parts[i + 1] = "[token]";
    }
  }
  return scrubPii(parts.join("/"));
}

/* ----- Event shape ----- */

export interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const FRAME_WITH_FN = /^\s*at\s+(.+?)\s+\((.+?)(?::(\d+))?(?::(\d+))?\)\s*$/;
const FRAME_BARE = /^\s*at\s+(.+?)(?::(\d+))?(?::(\d+))?\s*$/;

/** Parse a V8 stack into Sentry frames (oldest first, as Sentry expects). */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    let m = FRAME_WITH_FN.exec(line);
    let fn = "<anonymous>";
    let file: string | undefined;
    let lineno: string | undefined;
    let colno: string | undefined;
    if (m) {
      fn = m[1] ?? "<anonymous>";
      file = m[2];
      lineno = m[3];
      colno = m[4];
    } else {
      m = FRAME_BARE.exec(line);
      if (!m) continue;
      file = m[1];
      lineno = m[2];
      colno = m[3];
    }
    if (!file) continue;
    frames.push({
      filename: scrubPii(file),
      function: scrubPii(fn),
      lineno: lineno ? Number(lineno) : undefined,
      colno: colno ? Number(colno) : undefined,
      in_app: !/node_modules|node:internal|^node:/.test(file),
    });
  }
  return frames.reverse();
}

export interface ErrorReportInput {
  error: unknown;
  /** Next's server error digest — the reference code the error page shows. */
  digest?: string | null;
  requestId?: string | null;
  path?: string | null;
  method?: string | null;
  /** Free-form, low-cardinality context (queue, routeType, source…). */
  tags?: Record<string, string | undefined>;
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: "node";
  level: "error";
  logger: "roster";
  release?: string;
  environment: string;
  transaction?: string;
  request?: { method?: string };
  tags: Record<string, string>;
  extra: Record<string, string>;
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: StackFrame[] };
    }>;
  };
}

function describe(error: unknown): {
  type: string;
  value: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      value: error.message || "(no message)",
      stack: error.stack,
    };
  }
  if (typeof error === "string") return { type: "Error", value: error };
  if (error && typeof error === "object") {
    const o = error as { name?: unknown; message?: unknown };
    return {
      type: typeof o.name === "string" ? o.name : "Error",
      value: typeof o.message === "string" ? o.message : "(non-error thrown)",
    };
  }
  return { type: "Error", value: String(error) };
}

export function buildEvent(
  input: ErrorReportInput,
  opts: { release: string | null; environment: string; now: Date },
): SentryEvent {
  const { type, value, stack } = describe(input.error);
  const frames = parseStack(stack);
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.tags ?? {})) {
    if (v !== undefined) tags[k] = scrubPii(String(v)).slice(0, 200);
  }
  const extra: Record<string, string> = {};
  if (input.digest) extra.digest = input.digest;
  if (input.requestId) extra.requestId = input.requestId;
  return {
    event_id: globalThis.crypto.randomUUID().replaceAll("-", ""),
    timestamp: opts.now.getTime() / 1000,
    platform: "node",
    level: "error",
    logger: "roster",
    ...(opts.release ? { release: opts.release } : {}),
    environment: opts.environment,
    ...(input.path ? { transaction: scrubPath(input.path) } : {}),
    ...(input.method ? { request: { method: input.method } } : {}),
    tags,
    extra,
    exception: {
      values: [
        {
          type: scrubPii(type),
          value: scrubPii(value).slice(0, 2000),
          ...(frames.length ? { stacktrace: { frames } } : {}),
        },
      ],
    },
  };
}

/** The envelope body: header line, item header line, item payload. */
export function buildEnvelope(
  event: SentryEvent,
  dsn: ParsedDsn,
  sentAt: Date,
): string {
  const header = {
    event_id: event.event_id,
    sent_at: sentAt.toISOString(),
    dsn: `${dsn.protocol}://${dsn.publicKey}@${dsn.host}${dsn.path}/${dsn.projectId}`,
  };
  const item = { type: "event", content_type: "application/json" };
  return `${JSON.stringify(header)}\n${JSON.stringify(item)}\n${JSON.stringify(event)}\n`;
}

/* ----- Reporter ----- */

export interface ErrorReporterOptions {
  dsn?: string | null;
  environment?: string;
  release?: string | null;
  fetchImpl?: typeof fetch;
  logger?: Pick<typeof defaultLogger, "error" | "warn">;
  now?: () => Date;
  /** Forwarding cap per rolling minute; logging is never capped. */
  maxPerMinute?: number;
  timeoutMs?: number;
}

export interface ErrorReporter {
  /** Log + (when configured and under the cap) forward. Never throws. */
  report(input: ErrorReportInput): Promise<void>;
  readonly forwarding: boolean;
}

export function createErrorReporter(
  options: ErrorReporterOptions = {},
): ErrorReporter {
  const dsn = parseDsn(options.dsn);
  const log = options.logger ?? defaultLogger;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const maxPerMinute = options.maxPerMinute ?? 30;
  const timeoutMs = options.timeoutMs ?? 3000;
  const environment = options.environment ?? "development";
  const release = options.release ?? null;
  const sentAt: number[] = [];
  let warnedInvalidDsn = false;

  if (options.dsn && !dsn && !warnedInvalidDsn) {
    warnedInvalidDsn = true;
    log.warn("SENTRY_DSN is set but not a valid DSN — error forwarding is off");
  }

  function underCap(at: Date): boolean {
    const cutoff = at.getTime() - 60_000;
    while (sentAt.length && sentAt[0]! < cutoff) sentAt.shift();
    if (sentAt.length >= maxPerMinute) return false;
    sentAt.push(at.getTime());
    return true;
  }

  return {
    forwarding: dsn !== null,
    async report(input) {
      const at = now();
      const { type, value } = describe(input.error);
      log.error(
        {
          err: input.error instanceof Error ? input.error : undefined,
          errorType: type,
          errorMessage: scrubPii(value),
          digest: input.digest ?? undefined,
          requestId: input.requestId ?? undefined,
          path: input.path ? scrubPath(input.path) : undefined,
          method: input.method ?? undefined,
          ...input.tags,
        },
        "Unhandled error",
      );
      if (!dsn || !underCap(at)) return;
      try {
        const event = buildEvent(input, { release, environment, now: at });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(envelopeUrl(dsn), {
            method: "POST",
            headers: {
              "Content-Type": "application/x-sentry-envelope",
              "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=roster/1.0, sentry_key=${dsn.publicKey}`,
            },
            body: buildEnvelope(event, dsn, at),
            signal: controller.signal,
          });
          if (!res.ok) {
            log.warn(
              { status: res.status },
              "Error report was not accepted by the error tracker",
            );
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        log.warn({ err }, "Error report could not be delivered");
      }
    },
  };
}

/** The release identifier the platforms expose, or null in a dev build. */
export function resolveRelease(
  vars: Record<string, string | undefined>,
): string | null {
  const sha =
    vars.APP_RELEASE ??
    vars.VERCEL_GIT_COMMIT_SHA ??
    vars.RAILWAY_GIT_COMMIT_SHA ??
    vars.GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 40) : null;
}

export function resolveEnvironment(
  vars: Record<string, string | undefined>,
): string {
  return (
    vars.SENTRY_ENVIRONMENT ??
    vars.VERCEL_ENV ??
    vars.RAILWAY_ENVIRONMENT_NAME ??
    vars.NODE_ENV ??
    "development"
  );
}

let defaultReporter: ErrorReporter | null = null;

/** The process-wide reporter, configured from the environment (fail closed). */
export function errorReporter(): ErrorReporter {
  if (!defaultReporter) {
    defaultReporter = createErrorReporter({
      dsn: env.SENTRY_DSN ?? null,
      environment: resolveEnvironment(process.env),
      release: resolveRelease(process.env),
    });
  }
  return defaultReporter;
}

/**
 * Report an unhandled error: structured log line + best-effort forwarding.
 * Fire-and-forget safe (`void reportError(...)`) — it never throws.
 */
export function reportError(input: ErrorReportInput): Promise<void> {
  return errorReporter().report(input);
}
