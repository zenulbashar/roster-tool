import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { findRequestByToken } from "@/lib/tenant/public-access";
import { generateToken } from "@/lib/tokens";
import {
  handleAvailabilityRequest,
  handleAvailabilityReminder,
  handlePublishedRoster,
} from "@/lib/jobs/handlers";

/**
 * End-to-end-ish coverage of the magic-link availability flow against the real
 * database: issuing a request, the send job (idempotent), resolving the token,
 * and saving + revising responses.
 */
describe("availability flow", () => {
  let businessId = "";
  let repo: TenantRepo;
  let periodId = "";
  let staffId = "";
  const shiftIds: string[] = [];

  beforeAll(async () => {
    const [biz] = await db
      .insert(businesses)
      .values({ name: "Flow Test Café" })
      .returning();
    businessId = biz!.id;
    repo = createTenantRepo(businessId);

    const staff = await repo.addStaff({ name: "Sam", email: "sam@flow.test" });
    staffId = staff.id;
    const period = await repo.createPeriod({
      label: "Test week",
      startDate: "2025-06-09",
      endDate: "2025-06-10",
    });
    periodId = period.id;
    const shifts = await repo.createShifts([
      {
        rosterPeriodId: periodId,
        date: "2025-06-09",
        label: "Morning",
        startTime: "07:00:00",
        endTime: "12:00:00",
      },
      {
        rosterPeriodId: periodId,
        date: "2025-06-09",
        label: "Evening",
        startTime: "17:00:00",
        endTime: "22:00:00",
      },
    ]);
    shiftIds.push(...shifts.map((s) => s.id));
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
    await db.$client.end();
  });

  it("issues a request and the send job emails the staff member once", async () => {
    const { token, tokenHash } = generateToken();
    const req = await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: staffId,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const send = vi.fn().mockResolvedValue(undefined);
    await handleAvailabilityRequest({ requestId: req.id, token }, { send });

    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0]![0];
    expect(msg.to).toBe("sam@flow.test");
    expect(msg.html).toContain(token);
    expect(msg.text).toContain(token);

    // Idempotent: a retry/duplicate must not send again.
    await handleAvailabilityRequest({ requestId: req.id, token }, { send });
    expect(send).toHaveBeenCalledOnce();

    // sentAt was recorded.
    const [after] = await repo.listRequests(periodId);
    expect(after?.sentAt).not.toBeNull();
  });

  it("resolves a valid token and rejects bad/expired ones", async () => {
    const { token, tokenHash } = generateToken();
    await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: (
        await repo.addStaff({ name: "Pat", email: "pat@flow.test" })
      ).id,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const found = await findRequestByToken(token);
    expect(found?.businessId).toBe(businessId);

    expect(await findRequestByToken("not-a-real-token")).toBeNull();

    // Expired token resolves to null.
    const { token: expToken, tokenHash: expHash } = generateToken();
    await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: (
        await repo.addStaff({ name: "Lee", email: "lee@flow.test" })
      ).id,
      tokenHash: expHash,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await findRequestByToken(expToken)).toBeNull();
  });

  it("saves and revises availability responses (idempotent upsert)", async () => {
    const { tokenHash } = generateToken();
    const member = await repo.addStaff({
      name: "Jo",
      email: "jo@flow.test",
    });
    const req = await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: member.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await repo.saveResponses(req.id, [
      { shiftId: shiftIds[0]!, available: true },
      { shiftId: shiftIds[1]!, available: false },
    ]);
    await repo.markRequestResponded(req.id);

    let saved = await repo.responsesForRequest(req.id);
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.shiftId === shiftIds[1])?.available).toBe(false);

    // Resubmit with a changed answer — upsert, not duplicate.
    await repo.saveResponses(req.id, [
      { shiftId: shiftIds[1]!, available: true },
    ]);
    saved = await repo.responsesForRequest(req.id);
    expect(saved).toHaveLength(2);
    expect(saved.find((r) => r.shiftId === shiftIds[1])?.available).toBe(true);
  });

  it("assigns and unassigns staff idempotently", async () => {
    await repo.assign(shiftIds[0]!, staffId);
    // Assigning again must not create a duplicate.
    await repo.assign(shiftIds[0]!, staffId);

    let rows = await repo.listAssignments(periodId);
    const forShift = rows.filter((a) => a.shiftId === shiftIds[0]);
    expect(forShift).toHaveLength(1);
    expect(forShift[0]?.staffMemberId).toBe(staffId);

    await repo.unassign(shiftIds[0]!, staffId);
    rows = await repo.listAssignments(periodId);
    expect(rows.some((a) => a.shiftId === shiftIds[0])).toBe(false);
  });

  it("reminds a non-responder once and is idempotent", async () => {
    const { token, tokenHash } = generateToken();
    const m = await repo.addStaff({ name: "Rey", email: "rey@flow.test" });
    const req = await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await repo.markRequestSent(req.id);

    const send = vi.fn().mockResolvedValue(undefined);
    await handleAvailabilityReminder({ requestId: req.id, token }, { send });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].to).toBe("rey@flow.test");

    // Re-running must not remind again.
    await handleAvailabilityReminder({ requestId: req.id, token }, { send });
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not remind someone who already responded", async () => {
    const { token, tokenHash } = generateToken();
    const m = await repo.addStaff({ name: "Mia", email: "mia@flow.test" });
    const req = await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await repo.markRequestSent(req.id);
    await repo.markRequestResponded(req.id);

    const send = vi.fn().mockResolvedValue(undefined);
    await handleAvailabilityReminder({ requestId: req.id, token }, { send });
    expect(send).not.toHaveBeenCalled();
  });

  it("emails a staff member their published shifts", async () => {
    await repo.publish(periodId, "public-slug-abc");
    const m = await repo.addStaff({ name: "Dee", email: "dee@flow.test" });
    await repo.assign(shiftIds[0]!, m.id);

    const send = vi.fn().mockResolvedValue(undefined);
    await handlePublishedRoster(
      { rosterPeriodId: periodId, staffMemberId: m.id },
      { send },
    );
    expect(send).toHaveBeenCalledOnce();
    const msg = send.mock.calls[0]![0];
    expect(msg.to).toBe("dee@flow.test");
    expect(msg.text).toContain("Morning");
    expect(msg.html).toContain("public-slug-abc");
  });

  it("the published email shows a person's own times + break when overridden", async () => {
    const m = await repo.addStaff({ name: "Fay", email: "fay@flow.test" });
    await repo.assign(shiftIds[1]!, m.id);
    // The builder stretched Fay's Evening (17:00–22:00) to 15:00–23:00 with a
    // 30 min break — her email must say HER hours, not the shift's.
    await repo.setAssignmentSchedule(shiftIds[1]!, m.id, {
      startTime: "15:00",
      endTime: "23:00",
      breakMinutes: 30,
      breakStart: "19:00",
    });

    const send = vi.fn().mockResolvedValue(undefined);
    await handlePublishedRoster(
      { rosterPeriodId: periodId, staffMemberId: m.id },
      { send },
    );
    const msg = send.mock.calls[0]![0];
    expect(msg.text).toContain("3 pm – 11 pm");
    expect(msg.text).toContain("30 min unpaid break");
    expect(msg.text).not.toContain("5 pm – 10 pm");
  });

  it("tells an unrostered staff member they have no shifts", async () => {
    const m = await repo.addStaff({ name: "Eli", email: "eli@flow.test" });
    const send = vi.fn().mockResolvedValue(undefined);
    await handlePublishedRoster(
      { rosterPeriodId: periodId, staffMemberId: m.id },
      { send },
    );
    expect(send.mock.calls[0]![0].text).toContain("not rostered");
  });
});
