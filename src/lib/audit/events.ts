import { createHash } from "node:crypto";

/**
 * Tenant audit trail (OPS-04 / SEC-02) — the PURE half: what an event is,
 * how its arguments are made safe to store, and the hash chain that makes the
 * trail tamper-EVIDENT. No I/O here; `store.ts` writes rows and `decorate.ts`
 * turns repository calls into events.
 *
 * One event per repository WRITE, recorded by construction (a decorator over
 * the repo — no per-action annotation, so a new mutator can't forget to log).
 * The event names the actor (owner / impersonating admin / system), the
 * method, the entity it touched, the sanitised arguments, and — for the
 * records that matter most (timesheets, staff, settings, pay rules …) — a
 * BEFORE snapshot and the AFTER row, so "who changed an employee's hours, from
 * what, to what, when" is answerable.
 *
 * Every event's `hash` covers its own content AND the previous event's hash in
 * the same scope (a business, or an org for org-level writes), so editing or
 * deleting a row breaks every hash after it; `verifyChain` finds the first
 * break. This is evidence, not prevention — a database owner can rewrite the
 * chain — which is why the operations runbook restricts UPDATE/DELETE on the
 * table at the grant level.
 */

export type AuditActorType = "owner" | "admin" | "staff" | "system";

export interface AuditActor {
  type: AuditActorType;
  /** The Auth.js user id (owner / admin), staff id, or null for system. */
  userId: string | null;
  /** Human label snapshotted at write time (email, admin name, job name). */
  label: string;
  /** Set when a Zale IT admin acts INSIDE a tenant ("view as venue"). */
  impersonatorUserId?: string | null;
}

export type AuditOutcome = "ok" | "error";

/** What the decorator hands the store: everything except scope + chain. */
export interface NewAuditEvent {
  actor: AuditActor;
  requestId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  args: unknown;
  before: unknown;
  after: unknown;
  outcome: AuditOutcome;
  error: string | null;
}

/** The fields the chain hash covers — a stored row, minus its own chain. */
export interface AuditHashPayload {
  businessId: string | null;
  orgId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  actorLabel: string;
  impersonatorUserId: string | null;
  requestId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  args: unknown;
  before: unknown;
  after: unknown;
  outcome: AuditOutcome;
  error: string | null;
  createdAt: string;
}

/* ----- Sanitisation ----- */

const REDACT_KEY = /(pin|hash|token|secret|password|enc$|_enc$)/i;
const MAX_STRING = 500;
const MAX_ARRAY = 50;
const MAX_DEPTH = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Positional arguments that are secrets by construction (a PIN hash, a
 * capability-token hash, an encrypted OAuth token) and so can never be stored,
 * whatever their key. Method → argument indexes.
 */
export const REDACTED_POSITIONS: Record<string, number[]> = {
  setStaffPin: [1],
  setStaffNoticesTokenHash: [1],
  updateDriveAccessToken: [0],
  updateXeroTokens: [0, 1],
};

/** A long, space-free string is an opaque secret until proven otherwise. */
function looksOpaque(value: string): boolean {
  return value.length >= 40 && !/\s/.test(value) && !UUID.test(value);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (looksOpaque(value)) return "[opaque]";
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (
    value instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
  ) {
    return `[binary ${(value as Uint8Array).byteLength} bytes]`;
  }
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (depth >= MAX_DEPTH) return "[nested]";
  if (Array.isArray(value)) {
    const out = value
      .slice(0, MAX_ARRAY)
      .map((v) => sanitizeValue(v, depth + 1));
    if (value.length > MAX_ARRAY)
      out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || typeof v === "function") continue;
      out[k] = REDACT_KEY.test(k) ? "[redacted]" : sanitizeValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Arguments as they may be STORED: secrets redacted by key and by position,
 * opaque strings masked, binary dropped, dates as ISO, strings and arrays
 * bounded, depth bounded. Returns plain JSON (round-trips through jsonb
 * unchanged, which the hash relies on).
 */
export function sanitizeArgs(action: string, args: unknown[]): unknown[] {
  const redacted = new Set(REDACTED_POSITIONS[action] ?? []);
  return JSON.parse(
    JSON.stringify(
      args.map((a, i) =>
        redacted.has(i) ? "[redacted]" : sanitizeValue(a, 0),
      ),
    ),
  );
}

/** Any value as it may be stored (same rules as arguments). */
export function sanitizeRecord(value: unknown): unknown {
  return JSON.parse(JSON.stringify(sanitizeValue(value, 0)));
}

/** The entity id a call is about: the first uuid argument, or `{ id }`. */
export function extractEntityId(args: unknown[]): string | null {
  for (const a of args) {
    if (typeof a === "string" && UUID.test(a)) return a;
    if (a && typeof a === "object" && !Array.isArray(a)) {
      const id = (a as { id?: unknown }).id;
      if (typeof id === "string" && UUID.test(id)) return id;
    }
  }
  return null;
}

/* ----- Hash chain ----- */

/** Deterministic JSON: object keys sorted recursively, arrays in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}

/** sha256 over (previous hash, canonical payload). */
export function computeEventHash(
  prevHash: string | null,
  payload: AuditHashPayload,
): string {
  return createHash("sha256")
    .update(prevHash ?? "")
    .update("\n")
    .update(canonicalJson(payload))
    .digest("hex");
}

export interface ChainedEvent extends AuditHashPayload {
  seq: number;
  prevHash: string | null;
  hash: string;
}

export type ChainVerdict =
  | { ok: true; checked: number }
  | {
      ok: false;
      checked: number;
      brokenAtSeq: number;
      reason: "hash_mismatch" | "prev_mismatch";
    };

/**
 * Walk events in `seq` order recomputing each hash from its content and the
 * previous event's hash. The first row whose stored hash (or stored previous
 * hash) disagrees is the break.
 */
export function verifyChain(events: readonly ChainedEvent[]): ChainVerdict {
  let prev: string | null = null;
  let checked = 0;
  for (const e of events) {
    if (e.prevHash !== prev) {
      return {
        ok: false,
        checked,
        brokenAtSeq: e.seq,
        reason: "prev_mismatch",
      };
    }
    const expected = computeEventHash(prev, stripChain(e));
    if (expected !== e.hash) {
      return {
        ok: false,
        checked,
        brokenAtSeq: e.seq,
        reason: "hash_mismatch",
      };
    }
    prev = e.hash;
    checked++;
  }
  return { ok: true, checked };
}

export function stripChain(e: ChainedEvent): AuditHashPayload {
  return {
    businessId: e.businessId,
    orgId: e.orgId,
    actorType: e.actorType,
    actorUserId: e.actorUserId,
    actorLabel: e.actorLabel,
    impersonatorUserId: e.impersonatorUserId,
    requestId: e.requestId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    args: e.args,
    before: e.before,
    after: e.after,
    outcome: e.outcome,
    error: e.error,
    createdAt: e.createdAt,
  };
}

/* ----- Presentation ----- */

/** "setEntryApproved" → "Set entry approved" — for the generic activity list. */
export function humanizeAction(action: string): string {
  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
