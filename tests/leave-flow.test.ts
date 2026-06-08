import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { handleLeaveDecision } from "@/lib/jobs/handlers";

/**
 * Integration coverage of the leave-request lifecycle against the real DB:
 * create pending → approve/deny sets status + decided_at; owner direct-entry is
 * approved; the upcoming/overlap queries; and tenant isolation on every owner
 * action (one business can't read, decide or delete another's leave, and a
 * foreign staff id can't create a row).
 */
describe("leave request flow", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA = "";
  let staffB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Leave Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Leave Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    staffA = (await repoA.addStaff({ name: "Ava", email: "ava@a.test" })).id;
    staffB = (await repoB.addStaff({ name: "Ben", email: "ben@b.test" })).id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("creates a pending request and approve sets status + decided_at", async () => {
    const created = await repoA.createLeaveRequest({
      staffMemberId: staffA,
      leaveType: "annual",
      startDate: "2026-06-10",
      endDate: "2026-06-14",
      note: "Trip away",
    });
    expect(created).not.toBeNull();
    expect(created!.status).toBe("pending");
    expect(created!.decidedAt).toBeNull();

    const before = new Date();
    const decided = await repoA.decideLeaveRequest(created!.id, "approved");
    expect(decided!.status).toBe("approved");
    expect(decided!.decidedAt).toBeInstanceOf(Date);
    expect(decided!.decidedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );

    // Deciding again is a no-op (only acts on pending).
    expect(await repoA.decideLeaveRequest(created!.id, "denied")).toBeNull();
  });

  it("deny sets status + decided_at", async () => {
    const created = await repoA.createLeaveRequest({
      staffMemberId: staffA,
      leaveType: "sick",
      startDate: "2026-07-01",
      endDate: "2026-07-01",
    });
    const decided = await repoA.decideLeaveRequest(created!.id, "denied");
    expect(decided!.status).toBe("denied");
    expect(decided!.decidedAt).toBeInstanceOf(Date);
  });

  it("owner direct-entry is stored as approved with decided_at", async () => {
    const created = await repoA.createLeaveRequest({
      staffMemberId: staffA,
      leaveType: "unpaid",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      status: "approved",
      decidedAt: new Date(),
    });
    expect(created!.status).toBe("approved");
    expect(created!.decidedAt).toBeInstanceOf(Date);
  });

  it("lists pending and upcoming-approved leave with staff names", async () => {
    const pending = await repoA.listLeaveByStatus("pending");
    expect(pending.every((r) => r.staffName === "Ava")).toBe(true);

    const upcoming = await repoA.listUpcomingApprovedLeave("2026-06-01");
    expect(upcoming.some((r) => r.startDate === "2026-06-10")).toBe(true);
    // A past approved range is excluded once its end date has gone by.
    const future = await repoA.listUpcomingApprovedLeave("2027-01-01");
    expect(future.length).toBe(0);
  });

  it("returns only approved leave overlapping a window", async () => {
    const overlap = await repoA.listApprovedLeaveBetween(
      "2026-06-12",
      "2026-06-20",
    );
    // The 10–14 approved range overlaps; the denied 07-01 range does not appear.
    expect(overlap.some((r) => r.startDate === "2026-06-10")).toBe(true);
    expect(overlap.some((r) => r.startDate === "2026-07-01")).toBe(false);

    const none = await repoA.listApprovedLeaveBetween(
      "2026-06-15",
      "2026-06-19",
    );
    expect(none.length).toBe(0);
  });

  it("rejects a foreign staff id on create", async () => {
    // Repo A cannot create leave for business B's staff member.
    expect(
      await repoA.createLeaveRequest({
        staffMemberId: staffB,
        leaveType: "other",
        startDate: "2026-06-10",
        endDate: "2026-06-10",
      }),
    ).toBeNull();
  });

  it("isolates leave across tenants for read/decide/delete", async () => {
    const inA = await repoA.createLeaveRequest({
      staffMemberId: staffA,
      leaveType: "annual",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
    });

    // B can't see it, decide it, or delete it.
    expect(await repoB.getLeaveRequest(inA!.id)).toBeNull();
    expect(await repoB.decideLeaveRequest(inA!.id, "approved")).toBeNull();
    await repoB.deleteLeaveRequest(inA!.id);
    expect((await repoA.getLeaveRequest(inA!.id))?.status).toBe("pending");

    // A can delete its own.
    await repoA.deleteLeaveRequest(inA!.id);
    expect(await repoA.getLeaveRequest(inA!.id)).toBeNull();
  });

  it("emails the decision once (idempotent) and skips while pending", async () => {
    const req = await repoA.createLeaveRequest({
      staffMemberId: staffA,
      leaveType: "annual",
      startDate: "2026-10-05",
      endDate: "2026-10-09",
    });

    // Pending → no email.
    const send = vi.fn().mockResolvedValue(undefined);
    await handleLeaveDecision({ leaveRequestId: req!.id }, { send });
    expect(send).not.toHaveBeenCalled();

    // Decide, then the email goes out once.
    await repoA.decideLeaveRequest(req!.id, "approved");
    await handleLeaveDecision({ leaveRequestId: req!.id }, { send });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0];
    expect(sent.to).toBe("ava@a.test");
    expect(sent.subject).toContain("approved");
    expect(sent.text).toContain("approved");

    // A retry / duplicate enqueue must NOT resend (decision_notified_at set).
    await handleLeaveDecision({ leaveRequestId: req!.id }, { send });
    expect(send).toHaveBeenCalledTimes(1);

    await repoA.deleteLeaveRequest(req!.id);
  });
});
