import { describe, it, expect } from "vitest";
import {
  sanitizeArgs,
  sanitizeRecord,
  extractEntityId,
  canonicalJson,
  computeEventHash,
  verifyChain,
  humanizeAction,
  type AuditHashPayload,
  type ChainedEvent,
} from "@/lib/audit/events";
import {
  describeActor,
  describeEvent,
  describeTimesheetEvent,
  type DescribableEvent,
} from "@/lib/audit/describe";
import { isMutatorName } from "@/lib/tenant/method-kinds";

/**
 * OPS-04 / SEC-02 — the pure half of the audit trail: what may be stored
 * (secrets never), how an event is identified, the hash chain that makes the
 * trail tamper-evident, and the plain-language descriptions.
 */
const UUID = "2f1c9d4e-8b7a-4c6d-9e5f-0a1b2c3d4e5f";

describe("argument sanitisation", () => {
  it("redacts secret-looking keys wherever they sit", () => {
    const [out] = sanitizeArgs("updateBusinessSettings", [
      {
        name: "Cafe",
        kioskTokenHash: "abc",
        nested: { pinHash: "x", accessTokenEnc: "y", password: "z", ok: 1 },
      },
    ]) as [Record<string, unknown>];
    expect(out.name).toBe("Cafe");
    expect(out.kioskTokenHash).toBe("[redacted]");
    expect(out.nested).toEqual({
      pinHash: "[redacted]",
      accessTokenEnc: "[redacted]",
      password: "[redacted]",
      ok: 1,
    });
  });

  it("redacts secret POSITIONS for the setters that take a bare secret", () => {
    expect(sanitizeArgs("setStaffPin", [UUID, "scrypt$salt$hash"])).toEqual([
      UUID,
      "[redacted]",
    ]);
    expect(sanitizeArgs("updateXeroTokens", ["a", "b", new Date(0)])).toEqual([
      "[redacted]",
      "[redacted]",
      "1970-01-01T00:00:00.000Z",
    ]);
  });

  it("masks opaque strings, drops binary, bounds strings/arrays/depth, keeps ids", () => {
    const opaque = "A".repeat(64);
    const long = "word ".repeat(200);
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const [args] = sanitizeArgs("x", [
      { opaque, long, photo: Buffer.from([1, 2, 3]), id: UUID, deep },
    ]) as [Record<string, unknown>];
    expect(args.opaque).toBe("[opaque]");
    expect((args.long as string).length).toBeLessThan(long.length);
    expect((args.long as string).endsWith("…")).toBe(true);
    expect(args.photo).toBe("[binary 3 bytes]");
    expect(args.id).toBe(UUID);
    expect(JSON.stringify(args.deep)).toContain("[nested]");

    const big = sanitizeArgs("x", [Array.from({ length: 60 }, (_, i) => i)]);
    expect((big[0] as unknown[]).length).toBe(51);
    expect((big[0] as unknown[])[50]).toBe("[+10 more]");
  });

  it("drops undefined/functions and round-trips through JSON", () => {
    const [out] = sanitizeArgs("x", [
      { keep: true, gone: undefined, fn: () => 1, when: new Date(1000) },
    ]) as [Record<string, unknown>];
    expect(out).toEqual({ keep: true, when: "1970-01-01T00:00:01.000Z" });
    expect(sanitizeRecord(null)).toBeNull();
  });

  it("finds the entity id: first uuid argument, or an object's id", () => {
    expect(extractEntityId([UUID, { x: 1 }])).toBe(UUID);
    expect(extractEntityId([{ id: UUID }])).toBe(UUID);
    expect(extractEntityId(["not-a-uuid", 3])).toBeNull();
    expect(extractEntityId([])).toBeNull();
  });
});

function payload(over: Partial<AuditHashPayload> = {}): AuditHashPayload {
  return {
    businessId: UUID,
    orgId: null,
    actorType: "owner",
    actorUserId: "u1",
    actorLabel: "owner@x.test",
    impersonatorUserId: null,
    requestId: "req-00000001",
    action: "updateEntry",
    entity: "timesheet_entry",
    entityId: UUID,
    args: [UUID, { breakMinutes: 30 }],
    before: { breakMinutes: 0 },
    after: { breakMinutes: 30 },
    outcome: "ok",
    error: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...over,
  };
}

describe("hash chain", () => {
  it("canonical JSON is key-order independent", () => {
    expect(
      canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }),
    ).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson([3, "x", null])).toBe('[3,"x",null]');
  });

  it("a hash covers the previous hash and the content", () => {
    const h1 = computeEventHash(null, payload());
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEventHash("other", payload())).not.toBe(h1);
    expect(computeEventHash(null, payload({ error: "x" }))).not.toBe(h1);
    expect(computeEventHash(null, payload())).toBe(h1); // deterministic
  });

  function chain(n: number): ChainedEvent[] {
    const out: ChainedEvent[] = [];
    let prev: string | null = null;
    for (let i = 0; i < n; i++) {
      const p = payload({ action: `a${i}` });
      const hash = computeEventHash(prev, p);
      out.push({ ...p, seq: i + 1, prevHash: prev, hash });
      prev = hash;
    }
    return out;
  }

  it("verifies an intact chain and pinpoints an altered or removed row", () => {
    expect(verifyChain([])).toEqual({ ok: true, checked: 0 });
    const events = chain(4);
    expect(verifyChain(events)).toEqual({ ok: true, checked: 4 });

    // Edit a row's content: its own hash no longer matches.
    const edited = events.map((e, i) =>
      i === 2 ? { ...e, actorLabel: "someone else" } : e,
    );
    expect(verifyChain(edited)).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
      reason: "hash_mismatch",
      checked: 2,
    });

    // Delete a row: the next row's stored prev no longer matches.
    const removed = events.filter((_, i) => i !== 1);
    expect(verifyChain(removed)).toMatchObject({
      ok: false,
      brokenAtSeq: 3,
      reason: "prev_mismatch",
    });
  });
});

describe("descriptions", () => {
  const base: DescribableEvent = {
    action: "updateEntry",
    entity: "timesheet_entry",
    args: [UUID, {}],
    before: {
      clockInAt: "2026-09-04T22:00:00.000Z",
      clockOutAt: "2026-09-05T02:00:00.000Z",
      breakMinutes: 0,
    },
    after: {
      clockInAt: "2026-09-04T22:00:00.000Z",
      clockOutAt: "2026-09-05T03:00:00.000Z",
      breakMinutes: 30,
    },
    outcome: "ok",
    error: null,
    actorLabel: "jane@cafe.test",
    actorType: "owner",
    impersonatorUserId: null,
    createdAt: new Date("2026-09-05T04:00:00.000Z"),
  };

  it("spells out what moved on a timesheet edit, in the business timezone", () => {
    const d = describeTimesheetEvent(base, "Australia/Sydney");
    expect(d.headline).toBe("Edited the times");
    expect(d.who).toBe("jane@cafe.test");
    expect(d.changes).toHaveLength(2);
    expect(d.changes[0]).toMatch(/^Clock out: .*→/);
    expect(d.changes[1]).toBe("Break: 0 min → 30 min");
    expect(d.when).toBeTruthy();
  });

  it("describes approvals from the argument, failures, and no-op saves", () => {
    expect(
      describeTimesheetEvent(
        { ...base, action: "setEntryApproved", args: [UUID, true] },
        "UTC",
      ).changes,
    ).toEqual(["Approved for payroll"]);
    expect(
      describeTimesheetEvent(
        { ...base, action: "setEntryApproved", args: [UUID, false] },
        "UTC",
      ).changes,
    ).toEqual(["Approval removed"]);
    expect(
      describeTimesheetEvent(
        { ...base, outcome: "error", error: "boom" },
        "UTC",
      ).headline,
    ).toBe("Edited the times — failed");
    expect(
      describeTimesheetEvent({ ...base, after: base.before }, "UTC").changes,
    ).toEqual(["Saved with no changes"]);
  });

  it("labels admins and the system, and humanises generic actions", () => {
    expect(
      describeActor({ ...base, actorType: "admin", actorLabel: "Priya" }),
    ).toBe("Priya (Zale IT)");
    expect(describeActor({ ...base, impersonatorUserId: "admin-1" })).toBe(
      "jane@cafe.test (Zale IT)",
    );
    expect(describeActor({ ...base, actorType: "system" })).toBe(
      "Roster (automatic)",
    );
    expect(humanizeAction("setEntryApproved")).toBe("Set entry approved");
    expect(humanizeAction("updateBusinessSettings")).toBe(
      "Update business settings",
    );
    expect(
      describeEvent({ ...base, action: "updateStaff", entity: "staff_member" }),
    ).toBe("Update staff · staff member");
    expect(
      describeEvent({
        ...base,
        action: "deleteItem",
        entity: null,
        outcome: "error",
      }),
    ).toBe("Delete item — failed");
  });
});

describe("method classification", () => {
  it("treats reads as reads and everything else as a write", () => {
    for (const r of [
      "listStaff",
      "getEntry",
      "countUnreadNotifications",
      "findOrgMemberByEmail",
      "hasConfirmedAssignment",
      "rosterRows",
      "locationBelongsToOrg",
      "loansForMarkers",
    ]) {
      expect(isMutatorName(r), r).toBe(false);
    }
    for (const w of [
      "updateEntry",
      "addStaff",
      "deleteItem",
      "approveOffer",
      "publish",
      "clockIn",
      "appendAuditEvent",
    ]) {
      expect(isMutatorName(w), w).toBe(true);
    }
  });
});
