import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, timesheetEntries } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import type {
  XeroClient,
  XeroDraftTimesheetInput,
  XeroTokenSet,
} from "@/lib/xero/client";
import { XeroApiError, XeroTimesheetAlreadyActioned } from "@/lib/xero/errors";
import {
  attemptIdempotencyKey,
  baseIdempotencyKey,
} from "@/lib/xero/idempotency";
import { cancelPush, pushEmployeeTimesheet } from "@/lib/xero/push";
import type { ActivePayRule } from "@/lib/xero/pay-rules";
import type { PushEntry } from "@/lib/xero/timesheet-lines";

/**
 * End-to-end push orchestration (#16) against the real DB with a fake client.
 * Focus: the DELETE-then-CREATE re-push state machine and the per-attempt
 * idempotency key — a live draft's id is only ever set after a create succeeds,
 * a delete-then-failed-create lands in the distinct "no draft exists" state, and
 * each create attempt carries a DIFFERENT key. Timesheet ids are globally unique
 * so a "new draft id" is never confused with a re-used one.
 */

let GLOBAL_TS_SEQ = 0;

class FakePushClient implements XeroClient {
  createKeys: string[] = [];
  deleteIds: string[] = [];
  getStatus = "Draft";
  getThrows404 = false;
  createThrows = false;
  deleteThrows = false;
  lastCreatedId: string | null = null;

  lastInput: XeroDraftTimesheetInput | null = null;

  async createDraftTimesheet(
    _a: string,
    _t: string,
    input: XeroDraftTimesheetInput,
    key: string,
  ) {
    this.createKeys.push(key);
    this.lastInput = input;
    if (this.createThrows) throw new XeroApiError("create failed", 500);
    this.lastCreatedId = `ts-${++GLOBAL_TS_SEQ}`;
    return { timesheetId: this.lastCreatedId, status: "Draft" };
  }
  async getTimesheet(_a: string, _t: string, id: string) {
    if (this.getThrows404) throw new XeroApiError("gone", 404);
    return { timesheetId: id, status: this.getStatus };
  }
  async deleteTimesheet(_a: string, _t: string, id: string) {
    this.deleteIds.push(id);
    if (this.deleteThrows) throw new XeroApiError("delete failed", 500);
  }
  // Unused by the push path — trivial stubs to satisfy the interface.
  buildAuthUrl() {
    return "";
  }
  exchangeCode(): Promise<XeroTokenSet> {
    return Promise.reject(new Error("unused"));
  }
  refreshAccessToken(): Promise<XeroTokenSet> {
    return Promise.reject(new Error("unused"));
  }
  async getConnections() {
    return [];
  }
  async listEmployees() {
    return [];
  }
  async listEarningsRates() {
    return [];
  }
  async getEmployeePayTemplateEarnings() {
    return [];
  }
  async getPayrollCalendar() {
    return null;
  }
}

const TZ = "Australia/Sydney";
const PERIOD = { start: "2026-07-06", end: "2026-07-12" };

// 6 Jul (Sydney) → 5h; a distinct set (7h) for the "changed" re-push.
const ENTRIES_A: PushEntry[] = [
  {
    clockInAt: new Date("2026-07-06T00:00:00Z"),
    clockOutAt: new Date("2026-07-06T05:00:00Z"),
  },
];
const ENTRIES_B: PushEntry[] = [
  {
    clockInAt: new Date("2026-07-06T00:00:00Z"),
    clockOutAt: new Date("2026-07-06T07:00:00Z"),
  },
];

describe("xero push orchestration", () => {
  let businessId = "";
  let repo: TenantRepo;
  let staffId = "";

  const common = () => ({
    repo,
    accessToken: "at",
    tenantId: "tenant-1",
    businessId,
    timezone: TZ,
    staffMemberId: staffId,
    xeroEmployeeId: "emp-1",
    earningsRateId: "rate-1" as string | null,
    payrollCalendarId: "cal-1",
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
  });

  const key = (attempt: number) =>
    attemptIdempotencyKey(
      baseIdempotencyKey({
        businessId,
        staffMemberId: staffId,
        periodStart: PERIOD.start,
        periodEnd: PERIOD.end,
      }),
      attempt,
    );

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Xero Push Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
    staffId = (await repo.addStaff({ name: "Ava", email: "ava@push.test" })).id;
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
    // Pool closed in the LAST describe's afterAll (both share one `db`).
  });

  it("blocks push when the earnings rate is unresolved", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      earningsRateId: null,
      entries: ENTRIES_A,
    });
    expect(out).toEqual({ status: "blocked", reason: "no_rate" });
    expect(client.createKeys).toHaveLength(0);
  });

  it("skips when there are no in-period hours", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: [],
    });
    expect(out).toEqual({ status: "skipped", reason: "no_hours" });
  });

  it("first push creates a Draft with attempt=1's key and stores the id", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_A,
    });
    expect(out.status).toBe("pushed");
    expect(client.createKeys).toEqual([key(1)]);

    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.status).toBe("draft");
    expect(row!.xeroTimesheetId).toBe(client.lastCreatedId);
    expect(row!.attempt).toBe(1);
    expect(row!.hoursTotal).toBe(5);
  });

  it("an unchanged re-push is a no-op (no delete, no create)", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_A,
    });
    expect(out.status).toBe("unchanged");
    expect(client.createKeys).toHaveLength(0);
    expect(client.deleteIds).toHaveLength(0);
  });

  it("a changed re-push DELETES the old then CREATES with a NEW (attempt=2) key", async () => {
    const before = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_B,
    });
    expect(out.status).toBe("pushed");
    expect(client.deleteIds).toEqual([before!.xeroTimesheetId]); // deleted old
    expect(client.createKeys).toEqual([key(2)]); // attempt 2, ≠ attempt 1
    expect(client.createKeys[0]).not.toBe(key(1));

    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.status).toBe("draft");
    expect(row!.xeroTimesheetId).toBe(client.lastCreatedId);
    expect(row!.xeroTimesheetId).not.toBe(before!.xeroTimesheetId); // new id
    expect(row!.attempt).toBe(2);
    expect(row!.hoursTotal).toBe(7);
  });

  it("delete-then-FAILED-create lands in the distinct 'no draft exists' state", async () => {
    const before = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    const client = new FakePushClient();
    client.createThrows = true; // create fails AFTER the delete succeeds
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_A, // changed back → real re-push
    });
    expect(out).toEqual({ status: "failed", reason: "no_draft_exists" });
    expect(client.deleteIds).toEqual([before!.xeroTimesheetId]); // old WAS deleted

    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    // Invariant: no live draft ⇒ status failed AND id NULL (never a deleted id).
    expect(row!.status).toBe("failed");
    expect(row!.xeroTimesheetId).toBeNull();
    expect(row!.attempt).toBe(3);
  });

  it("recovers from the 'no draft' state on the next push (create fresh, attempt+1)", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_A,
    });
    expect(out.status).toBe("pushed");
    expect(client.deleteIds).toHaveLength(0); // id was null → nothing to delete
    expect(client.createKeys).toEqual([key(4)]);
    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.status).toBe("draft");
    expect(row!.xeroTimesheetId).toBe(client.lastCreatedId);
    expect(row!.attempt).toBe(4);
  });

  it("blocks (never deletes) a draft a human already actioned in Xero", async () => {
    const before = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    const client = new FakePushClient();
    client.getStatus = "Approved"; // human approved it in Xero
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_B, // changed → would re-push, but must be blocked
    });
    expect(out).toEqual({ status: "blocked", reason: "already_actioned" });
    expect(client.deleteIds).toHaveLength(0);
    expect(client.createKeys).toHaveLength(0);

    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.status).toBe("draft"); // unchanged, still points at the draft
    expect(row!.xeroTimesheetId).toBe(before!.xeroTimesheetId);
  });

  it("a failed DELETE leaves the old draft live and the row unchanged", async () => {
    const before = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    const client = new FakePushClient();
    client.deleteThrows = true;
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES_B,
    });
    expect(out).toEqual({ status: "failed", reason: "delete_failed" });
    expect(client.createKeys).toHaveLength(0); // never created a replacement
    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.status).toBe("draft"); // unchanged — old draft still live
    expect(row!.xeroTimesheetId).toBe(before!.xeroTimesheetId);
  });

  it("cancel guards still-Draft, deletes, and nulls the id", async () => {
    const before = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    const client = new FakePushClient();
    const out = await cancelPush({
      repo,
      client,
      accessToken: "at",
      tenantId: "tenant-1",
      pushId: before!.id,
    });
    expect(out).toEqual({ status: "cancelled" });
    expect(client.deleteIds).toEqual([before!.xeroTimesheetId]);
    const after = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(after!.status).toBe("cancelled");
    expect(after!.xeroTimesheetId).toBeNull();
  });

  it("cancel throws XeroTimesheetAlreadyActioned when it's no longer Draft", async () => {
    // Re-push to get a live draft again, then have Xero report it Approved.
    await pushEmployeeTimesheet({
      ...common(),
      client: new FakePushClient(),
      entries: ENTRIES_A,
    });
    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);

    const cancelClient = new FakePushClient();
    cancelClient.getStatus = "Approved";
    await expect(
      cancelPush({
        repo,
        client: cancelClient,
        accessToken: "at",
        tenantId: "tenant-1",
        pushId: row!.id,
      }),
    ).rejects.toBeInstanceOf(XeroTimesheetAlreadyActioned);
    expect(cancelClient.deleteIds).toHaveLength(0);
  });
});

describe("xero push with owner pay rules", () => {
  let businessId = "";
  let repo: TenantRepo;
  let staffId = "";

  const SAT_RULE: ActivePayRule = {
    id: "rule-sat",
    name: "Saturday hours",
    priority: 1,
    condition: { type: "day_of_week", days: [6] },
    earningsRateId: "rate-sat",
    earningsRateName: "Saturday item",
  };
  // Sat 11 Jul 09:00–17:00 Sydney (8h, all on Saturday) + Mon 6 Jul 4h.
  const ENTRIES: PushEntry[] = [
    {
      clockInAt: new Date("2026-07-06T00:00:00Z"),
      clockOutAt: new Date("2026-07-06T04:00:00Z"),
    },
    {
      clockInAt: new Date("2026-07-10T23:00:00Z"),
      clockOutAt: new Date("2026-07-11T07:00:00Z"),
    },
  ];

  const common = () => ({
    repo,
    accessToken: "at",
    tenantId: "tenant-1",
    businessId,
    timezone: TZ,
    staffMemberId: staffId,
    xeroEmployeeId: "emp-2",
    earningsRateId: "rate-1" as string | null,
    payrollCalendarId: "cal-1",
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
  });

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Xero Rules Push Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
    staffId = (await repo.addStaff({ name: "Cam", email: "cam@push.test" })).id;
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
    // Pool closed in the LAST describe's afterAll (all share one `db`).
  });

  it("rules split the payload into per-pay-item lines; hours total is unchanged", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES,
      rules: [SAT_RULE],
    });
    expect(out.status).toBe("pushed");
    expect(client.lastInput!.lines).toEqual([
      { date: "2026-07-06", numberOfUnits: 4, earningsRateId: "rate-1" },
      { date: "2026-07-11", numberOfUnits: 8, earningsRateId: "rate-sat" },
    ]);
    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.hoursTotal).toBe(12); // rules move hours, never change them
  });

  it("the same rules re-pushed are a no-op; a rule edit re-pushes (new hash)", async () => {
    const unchanged = await pushEmployeeTimesheet({
      ...common(),
      client: new FakePushClient(),
      entries: ENTRIES,
      rules: [SAT_RULE],
    });
    expect(unchanged.status).toBe("unchanged");

    // Owner re-points the rule at a different one of THEIR pay items →
    // content changed → delete-then-create replaces the draft.
    const before = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES,
      rules: [{ ...SAT_RULE, earningsRateId: "rate-sat-v2" }],
    });
    expect(out.status).toBe("pushed");
    expect(client.deleteIds).toEqual([before!.xeroTimesheetId]);
    expect(client.lastInput!.lines[1]!.earningsRateId).toBe("rate-sat-v2");
    const row = await repo.getXeroPush(staffId, PERIOD.start, PERIOD.end);
    expect(row!.attempt).toBe(before!.attempt + 1);
  });

  it("removing all rules re-pushes back to ordinary-only lines", async () => {
    const client = new FakePushClient();
    const out = await pushEmployeeTimesheet({
      ...common(),
      client,
      entries: ENTRIES,
      rules: [],
    });
    expect(out.status).toBe("pushed");
    expect(
      client.lastInput!.lines.every((l) => l.earningsRateId === "rate-1"),
    ).toBe(true);
  });
});

describe("listApprovedClosedEntriesForPush", () => {
  let businessId = "";
  let repo: TenantRepo;
  let staffId = "";

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Xero Push Query Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
    staffId = (await repo.addStaff({ name: "Ben", email: "ben@pushq.test" }))
      .id;
    await db.insert(timesheetEntries).values([
      {
        businessId,
        staffMemberId: staffId,
        clockInAt: new Date("2026-07-06T01:00:00Z"),
        clockOutAt: new Date("2026-07-06T05:00:00Z"),
        approved: true,
      }, // approved + closed + in window → included
      {
        businessId,
        staffMemberId: staffId,
        clockInAt: new Date("2026-07-07T01:00:00Z"),
        clockOutAt: null,
        approved: true,
      }, // approved but OPEN → excluded
      {
        businessId,
        staffMemberId: staffId,
        clockInAt: new Date("2026-07-08T01:00:00Z"),
        clockOutAt: new Date("2026-07-08T05:00:00Z"),
        approved: false,
      }, // closed but UNAPPROVED → excluded
    ]);
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
    await db.$client.end();
  });

  it("returns only approved, closed entries in the window", async () => {
    const rows = await repo.listApprovedClosedEntriesForPush(
      new Date("2026-07-05T00:00:00Z"),
      new Date("2026-07-13T00:00:00Z"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clockOutAt).not.toBeNull();
  });
});
