import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { withAudit, type AuditSink } from "@/lib/audit/decorate";
import type { AuditContext } from "@/lib/audit/decorate";
import type { NewAuditEvent } from "@/lib/audit/events";
import { isMutatorName } from "@/lib/tenant/method-kinds";
import { makeOrgWithTwoLocations, type TwoLocationOrg } from "./helpers/org";

/**
 * OPS-04 / SEC-02 / SEC-03 — the audit decorator against Postgres: every
 * repository write through an owner context becomes one chained event with
 * the actor, sanitised arguments and before/after; reads never do; a write
 * made while impersonating is mirrored to the admin log SERVER-SIDE; the
 * chain detects a row altered after the fact; the flag is a true kill switch;
 * and EVERY mutator on the repo is covered — by construction, not by list.
 */
describe("audit trail (flow)", () => {
  let org: TwoLocationOrg;
  let raw: TenantRepo;
  let audited: TenantRepo;
  let staffId = "";
  let entryId = "";

  const ownerCtx: AuditContext = {
    enabled: true,
    requestId: "req-audit-flow-1",
    actor: {
      type: "owner",
      userId: "user-owner",
      label: "owner@audit.test",
      impersonatorUserId: null,
    },
  };

  const mirror = vi.fn(async (_e: NewAuditEvent) => {});
  function sinkFor(repo: TenantRepo, orgId: string): AuditSink {
    return {
      append: (e) => repo.appendAuditEvent({ ...e, orgId }),
      onImpersonatedWrite: mirror,
    };
  }

  beforeAll(async () => {
    org = await makeOrgWithTwoLocations({ prefix: "audit" });
    raw = createTenantRepo(org.bizA);
    audited = withAudit(raw, sinkFor(raw, org.orgId), ownerCtx);
    const staff = await raw.addStaff({ name: "Ada", email: "ada@audit.test" });
    staffId = staff.id;
    const entry = await raw.clockIn(staffId, {
      at: new Date("2026-09-01T22:00:00.000Z"),
    });
    await raw.clockOut(entry.id, new Date("2026-09-02T02:00:00.000Z"));
    entryId = entry.id;
  });

  afterAll(async () => {
    await org.cleanup();
    await db.$client.end();
  });

  it("records a timesheet edit with actor, request id, before and after", async () => {
    const result = await audited.updateEntry(entryId, {
      clockInAt: new Date("2026-09-01T22:00:00.000Z"),
      clockOutAt: new Date("2026-09-02T03:00:00.000Z"),
      breakMinutes: 30,
    });
    expect(result?.breakMinutes).toBe(30);

    const [ev] = await raw.listAuditEventsForEntities("timesheet_entry", [
      entryId,
    ]);
    expect(ev).toBeTruthy();
    expect(ev!.action).toBe("updateEntry");
    expect(ev!.entity).toBe("timesheet_entry");
    expect(ev!.entityId).toBe(entryId);
    expect(ev!.actorType).toBe("owner");
    expect(ev!.actorLabel).toBe("owner@audit.test");
    expect(ev!.requestId).toBe("req-audit-flow-1");
    expect(ev!.businessId).toBe(org.bizA);
    expect(ev!.orgId).toBe(org.orgId);
    expect(ev!.outcome).toBe("ok");
    expect((ev!.before as { breakMinutes: number }).breakMinutes).toBe(0);
    expect((ev!.after as { breakMinutes: number }).breakMinutes).toBe(30);
    expect((ev!.before as { clockOutAt: string }).clockOutAt).toBe(
      "2026-09-02T02:00:00.000Z",
    );
    expect((ev!.after as { clockOutAt: string }).clockOutAt).toBe(
      "2026-09-02T03:00:00.000Z",
    );
    expect(ev!.prevHash).toBeNull(); // first event in this business
    expect(ev!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains the next event onto the previous hash and never records reads", async () => {
    const before = await raw.listAuditEvents();
    await audited.getEntry(entryId);
    await audited.listStaff();
    expect((await raw.listAuditEvents()).length).toBe(before.length);

    await audited.setEntryApproved(entryId, true);
    const [latest, previous] = await raw.listAuditEvents({ limit: 2 });
    expect(latest!.action).toBe("setEntryApproved");
    expect(latest!.prevHash).toBe(previous!.hash);
    expect(latest!.args).toEqual([entryId, true]);
  });

  it("never stores a PIN hash, and logs a refused (foreign id) write as a no-op result", async () => {
    await audited.setStaffPin(staffId, "scrypt$salt$secret");
    const [ev] = await raw.listAuditEvents({ limit: 1 });
    expect(ev!.action).toBe("setStaffPin");
    expect(ev!.args).toEqual([staffId, "[redacted]"]);
    expect(JSON.stringify(ev)).not.toContain("secret");

    const foreign = "00000000-0000-0000-0000-000000000000";
    expect(await audited.setEntryApproved(foreign, true)).toBeNull();
    const [refused] = await raw.listAuditEvents({ limit: 1 });
    expect(refused!.action).toBe("setEntryApproved");
    expect(refused!.entityId).toBe(foreign);
    expect(refused!.after).toBeNull();
  });

  it("records a failing write as an error and rethrows", async () => {
    await expect(
      audited.updateEntry("not-a-uuid", {
        clockInAt: new Date(),
        clockOutAt: null,
      }),
    ).rejects.toThrow();
    const [ev] = await raw.listAuditEvents({ limit: 1 });
    expect(ev!.action).toBe("updateEntry");
    expect(ev!.outcome).toBe("error");
    expect(ev!.error).toBeTruthy();
  });

  it("mirrors an impersonated write to the admin log, server-side", async () => {
    const adminCtx: AuditContext = {
      enabled: true,
      requestId: null,
      actor: {
        type: "admin",
        userId: "admin-1",
        label: "Priya",
        impersonatorUserId: "admin-1",
      },
    };
    const asAdmin = withAudit(raw, sinkFor(raw, org.orgId), adminCtx);
    mirror.mockClear();
    await asAdmin.updateStaff(staffId, { role: "Barista" });
    expect(mirror).toHaveBeenCalledTimes(1);
    expect(mirror.mock.calls[0]![0]).toMatchObject({
      action: "updateStaff",
      entity: "staff_member",
      entityId: staffId,
      actor: { type: "admin", impersonatorUserId: "admin-1" },
    });
    const [ev] = await raw.listAuditEvents({ limit: 1 });
    expect(ev!.actorType).toBe("admin");
    expect(ev!.impersonatorUserId).toBe("admin-1");
    expect((ev!.before as { role: string | null }).role).toBeNull();
    expect((ev!.after as { role: string }).role).toBe("Barista");

    // An owner's write is never mirrored.
    mirror.mockClear();
    await audited.updateStaff(staffId, { role: "Chef" });
    expect(mirror).not.toHaveBeenCalled();
  });

  it("the flag is a kill switch: disabled = the raw repo, nothing recorded", async () => {
    const off = withAudit(raw, sinkFor(raw, org.orgId), {
      ...ownerCtx,
      enabled: false,
    });
    expect(off).toBe(raw);
    const n = (await raw.listAuditEvents()).length;
    await off.updateStaff(staffId, { role: "Floor" });
    expect((await raw.listAuditEvents()).length).toBe(n);
  });

  it("scopes the trail per business and keeps org-level writes on the org chain", async () => {
    const repoB = createTenantRepo(org.bizB);
    expect(await repoB.listAuditEvents()).toEqual([]);
    expect(
      await repoB.listAuditEventsForEntities("timesheet_entry", [entryId]),
    ).toEqual([]);

    const orgRaw = createOrgRepo(org.orgId);
    const orgAudited = withAudit(
      orgRaw,
      { append: (e) => orgRaw.appendAuditEvent(e) },
      ownerCtx,
    );
    await orgAudited.addPersonToLocation(staffId, org.bizB);
    const [orgEv] = await orgRaw.listAuditEvents({ limit: 1 });
    expect(orgEv!.action).toBe("addPersonToLocation");
    expect(orgEv!.businessId).toBeNull();
    expect(orgEv!.orgId).toBe(org.orgId);
    // ...and org reads pass through unrecorded.
    const n = (await orgRaw.listAuditEvents()).length;
    await orgAudited.listLocations();
    await orgAudited.locationBelongsToOrg(org.bizA);
    await orgAudited.loansForMarkers();
    expect((await orgRaw.listAuditEvents()).length).toBe(n);
  });

  it("verifies the chain, and detects a row altered after the fact", async () => {
    const verdict = await raw.getAuditChainStatus();
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBeGreaterThan(3);

    const rows = await raw.listAuditEvents();
    const victim = rows[Math.floor(rows.length / 2)]!;
    await db
      .update(auditEvents)
      .set({ actorLabel: "someone else" })
      .where(eq(auditEvents.id, victim.id));
    const broken = await raw.getAuditChainStatus();
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.brokenAtSeq).toBe(Number(victim.seq));
    expect(!broken.ok && broken.reason).toBe("hash_mismatch");
  });

  it("covers EVERY mutator on the repo, by construction", async () => {
    // A throwaway business: the calls below are garbage on purpose.
    const [biz] = await db
      .insert(businesses)
      .values({ name: "Audit Coverage Biz" })
      .returning();
    try {
      const target = createTenantRepo(biz!.id);
      const wrapped = withAudit(
        target,
        { append: (e) => target.appendAuditEvent(e) },
        ownerCtx,
      );
      const mutators = Object.keys(target).filter(
        (k) =>
          isMutatorName(k) &&
          k !== "appendAuditEvent" &&
          typeof (target as Record<string, unknown>)[k] === "function",
      );
      expect(mutators.length).toBeGreaterThan(80);
      for (const name of mutators) {
        try {
          await (wrapped as unknown as Record<string, () => Promise<unknown>>)[
            name
          ]!();
        } catch {
          // A garbage call may throw — the decorator records that too.
        }
      }
      const logged = new Set(
        (await target.listAuditEvents({ limit: 1000 })).map((e) => e.action),
      );
      const missing = mutators.filter((m) => !logged.has(m));
      expect(missing).toEqual([]);
    } finally {
      await db.delete(businesses).where(eq(businesses.id, biz!.id));
    }
  });
});
