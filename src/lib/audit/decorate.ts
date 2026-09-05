import { isMutatorName } from "@/lib/tenant/method-kinds";
import { reportError } from "@/lib/error-reporting";
import {
  extractEntityId,
  sanitizeArgs,
  type AuditActor,
  type NewAuditEvent,
} from "./events";
import {
  METHOD_SNAPSHOTS,
  pickEntityFields,
  summarizeResult,
  type SnapshotReaders,
} from "./snapshots";

/**
 * The audit decorator (OPS-04 / SEC-02 / SEC-03): wrap a repository so EVERY
 * mutating method call is recorded — by construction, with no per-action
 * annotation and no way for a new mutator to forget. Reads pass straight
 * through. The wrapped object keeps its type, so no call site changes.
 *
 * For each write: take a BEFORE snapshot where the method is known
 * (`METHOD_SNAPSHOTS`, via the repo's own scoped getter), run the real method
 * with `this` bound to the UNWRAPPED repo (so internal `this.x()` calls are
 * never double-logged), then append one event — sanitised arguments, entity,
 * before/after, outcome — and, when the actor is an admin acting inside the
 * tenant, mirror it into `admin_activity` (the console's accountability log)
 * SERVER-SIDE, which supersedes the old client-reported entries.
 *
 * Recording is BEST-EFFORT: the write has already committed when the event is
 * appended, and a failure to append is reported to the error tracker rather
 * than failing the owner's action. Whether it runs at all is the
 * `audit_events` feature flag (the kill switch), resolved once per request.
 */

export interface AuditSink {
  /** Append one event in this repo's scope (business or org). */
  append(event: NewAuditEvent): Promise<unknown>;
  /** Called for a write made by an impersonating admin (best-effort). */
  onImpersonatedWrite?: (event: NewAuditEvent) => Promise<void>;
}

export interface AuditContext {
  actor: AuditActor;
  requestId: string | null;
  /** The `audit_events` flag; false = pass-through, nothing recorded. */
  enabled: boolean;
}

export function withAudit<T extends object>(
  target: T,
  sink: AuditSink,
  ctx: AuditContext,
): T {
  if (!ctx.enabled) return target;
  const readers = target as unknown as SnapshotReaders;

  async function record(event: NewAuditEvent): Promise<void> {
    try {
      await sink.append(event);
      if (ctx.actor.impersonatorUserId && sink.onImpersonatedWrite) {
        await sink.onImpersonatedWrite(event);
      }
    } catch (err) {
      await reportError({
        error: err,
        requestId: ctx.requestId,
        tags: { source: "audit", action: event.action },
      });
    }
  }

  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!isMutatorName(prop)) return value;
      const method = value as (...args: unknown[]) => unknown;
      const action = prop;

      return async function audited(...args: unknown[]) {
        const spec = METHOD_SNAPSHOTS[action];
        const entity = spec?.entity ?? null;
        let before: unknown = null;
        if (spec) {
          try {
            const row = await spec.read(readers, args);
            before = row ? pickEntityFields(spec.entity, row) : null;
          } catch {
            before = null;
          }
        }
        const base = {
          actor: ctx.actor,
          requestId: ctx.requestId,
          action,
          entity,
          entityId: extractEntityId(args),
          args: sanitizeArgs(action, args),
          before,
        };
        try {
          const result = await method.apply(obj, args);
          await record({
            ...base,
            after: summarizeResult(entity, result),
            outcome: "ok",
            error: null,
          });
          return result;
        } catch (err) {
          await record({
            ...base,
            after: null,
            outcome: "error",
            error:
              err instanceof Error
                ? err.message.slice(0, 500)
                : String(err).slice(0, 500),
          });
          throw err;
        }
      };
    },
  });
}
