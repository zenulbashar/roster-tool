import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import {
  computeEventHash,
  verifyChain,
  type AuditHashPayload,
  type ChainVerdict,
  type NewAuditEvent,
} from "./events";

/**
 * Writes and reads for `audit_event` — used ONLY by the tenant and org repos,
 * which force the scope. Appends serialise per scope (an advisory transaction
 * lock keyed on the business, or the org for org-level writes) so the hash
 * chain never forks under concurrent requests.
 */

export interface AuditScope {
  businessId: string | null;
  orgId: string | null;
}

function scopeWhere(scope: AuditScope) {
  return scope.businessId
    ? eq(auditEvents.businessId, scope.businessId)
    : and(isNull(auditEvents.businessId), eq(auditEvents.orgId, scope.orgId!));
}

export async function appendAuditEventRow(
  database: Db,
  scope: AuditScope,
  input: NewAuditEvent,
) {
  const key = scope.businessId ?? scope.orgId;
  if (!key) throw new Error("audit event needs a business or org scope");
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [last] = await tx
      .select({ hash: auditEvents.hash })
      .from(auditEvents)
      .where(scopeWhere(scope))
      .orderBy(desc(auditEvents.seq))
      .limit(1);
    const createdAt = new Date();
    const payload: AuditHashPayload = {
      businessId: scope.businessId,
      orgId: scope.orgId,
      actorType: input.actor.type,
      actorUserId: input.actor.userId,
      actorLabel: input.actor.label,
      impersonatorUserId: input.actor.impersonatorUserId ?? null,
      requestId: input.requestId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      args: input.args ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      outcome: input.outcome,
      error: input.error,
      createdAt: createdAt.toISOString(),
    };
    const prevHash = last?.hash ?? null;
    const hash = computeEventHash(prevHash, payload);
    const [row] = await tx
      .insert(auditEvents)
      .values({
        businessId: payload.businessId,
        orgId: payload.orgId,
        actorType: payload.actorType,
        actorUserId: payload.actorUserId,
        actorLabel: payload.actorLabel,
        impersonatorUserId: payload.impersonatorUserId,
        requestId: payload.requestId,
        action: payload.action,
        entity: payload.entity,
        entityId: payload.entityId,
        args: payload.args,
        before: payload.before,
        after: payload.after,
        outcome: payload.outcome,
        error: payload.error,
        prevHash,
        hash,
        createdAt,
      })
      .returning();
    return row!;
  });
}

export function listAuditEventRows(
  database: Db,
  scope: AuditScope,
  opts: { limit?: number; offset?: number } = {},
) {
  return database
    .select()
    .from(auditEvents)
    .where(scopeWhere(scope))
    .orderBy(desc(auditEvents.seq))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

export function listAuditEventRowsForEntities(
  database: Db,
  scope: AuditScope,
  entity: string,
  entityIds: string[],
) {
  if (entityIds.length === 0) return Promise.resolve([]);
  return database
    .select()
    .from(auditEvents)
    .where(
      and(
        scopeWhere(scope),
        eq(auditEvents.entity, entity),
        inArray(auditEvents.entityId, entityIds),
      ),
    )
    .orderBy(desc(auditEvents.seq));
}

/** Recompute the whole chain for a scope (a maintenance/verification read). */
export async function verifyAuditChain(
  database: Db,
  scope: AuditScope,
): Promise<ChainVerdict> {
  const rows = await database
    .select()
    .from(auditEvents)
    .where(scopeWhere(scope))
    .orderBy(asc(auditEvents.seq));
  return verifyChain(
    rows.map((r) => ({
      seq: Number(r.seq),
      prevHash: r.prevHash,
      hash: r.hash,
      businessId: r.businessId,
      orgId: r.orgId,
      actorType: r.actorType,
      actorUserId: r.actorUserId,
      actorLabel: r.actorLabel,
      impersonatorUserId: r.impersonatorUserId,
      requestId: r.requestId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      args: r.args,
      before: r.before,
      after: r.after,
      outcome: r.outcome,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    })),
  );
}
