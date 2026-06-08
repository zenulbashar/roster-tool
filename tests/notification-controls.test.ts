import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { handleAvailabilityReminder } from "@/lib/jobs/handlers";
import { generateToken } from "@/lib/tokens";

/**
 * Covers the notification-control + draft features against the real database:
 * manual pre-fill, reminder skipping, and suggested (draft) assignments.
 */
describe("notification controls + suggestions", () => {
  let businessId = "";
  let otherBusinessId = "";
  let repo: TenantRepo;
  let periodId = "";
  const shiftIds: string[] = [];

  beforeAll(async () => {
    const [biz] = await db
      .insert(businesses)
      .values({ name: "Notify Test Café" })
      .returning();
    const [other] = await db
      .insert(businesses)
      .values({ name: "Other Café" })
      .returning();
    businessId = biz!.id;
    otherBusinessId = other!.id;
    repo = createTenantRepo(businessId);

    const period = await repo.createPeriod({
      label: "Week",
      startDate: "2025-06-09",
      endDate: "2025-06-09",
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
    if (otherBusinessId)
      await db.delete(businesses).where(eq(businesses.id, otherBusinessId));
    await db.$client.end();
  });

  it("marks all shifts available manually, idempotently, with source=manual", async () => {
    const m = await repo.addStaff({ name: "Pia", email: "pia@notify.test" });

    const count = await repo.markAvailableManually(m.id, periodId);
    expect(count).toBe(shiftIds.length);

    // Re-running doesn't duplicate.
    await repo.markAvailableManually(m.id, periodId);

    const responses = await repo.listResponses(periodId);
    const mine = responses.filter((r) => r.staffMemberId === m.id);
    expect(mine).toHaveLength(shiftIds.length);
    expect(mine.every((r) => r.available)).toBe(true);
    expect(mine.every((r) => r.source === "manual")).toBe(true);

    expect(await repo.hasManualResponses(m.id, periodId)).toBe(true);
  });

  it("refuses to pre-fill a staff member from another business", async () => {
    const otherRepo = createTenantRepo(otherBusinessId);
    const intruder = await otherRepo.addStaff({
      name: "Mal",
      email: "mal@other.test",
    });
    // Our repo must not touch a foreign staff member.
    const count = await repo.markAvailableManually(intruder.id, periodId);
    expect(count).toBe(0);
    expect(await repo.hasManualResponses(intruder.id, periodId)).toBe(false);
  });

  it("does not remind a staff member who was pre-filled", async () => {
    const m = await repo.addStaff({ name: "Ned", email: "ned@notify.test" });
    const { token, tokenHash } = generateToken();
    const req = await repo.createRequest({
      rosterPeriodId: periodId,
      staffMemberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await repo.markRequestSent(req.id);
    // Owner pre-fills them after the request was sent.
    await repo.markAvailableManually(m.id, periodId);

    const send = vi.fn().mockResolvedValue(undefined);
    await handleAvailabilityReminder({ requestId: req.id, token }, { send });
    expect(send).not.toHaveBeenCalled();
  });

  it("creates suggested assignments that are excluded from the published roster", async () => {
    const m = await repo.addStaff({ name: "Ola", email: "ola@notify.test" });
    await repo.createSuggestedAssignments([
      { shiftId: shiftIds[0]!, staffMemberId: m.id },
    ]);

    const assignments = await repo.listAssignments(periodId);
    const a = assignments.find((x) => x.staffMemberId === m.id);
    expect(a?.status).toBe("suggested");

    // Suggested assignments must not appear in the published view.
    const rows = await repo.rosterRows(periodId);
    const rostered = rows.filter(
      (r) => r.shiftId === shiftIds[0] && r.staffMemberId === m.id,
    );
    expect(rostered).toHaveLength(0);

    // Accepting promotes it to confirmed and it becomes publishable.
    await repo.acceptSuggestion(shiftIds[0]!, m.id);
    const after = await repo.listAssignments(periodId);
    expect(after.find((x) => x.staffMemberId === m.id)?.status).toBe(
      "confirmed",
    );
    const rowsAfter = await repo.rosterRows(periodId);
    expect(
      rowsAfter.some(
        (r) => r.shiftId === shiftIds[0] && r.staffMemberId === m.id,
      ),
    ).toBe(true);
  });

  it("accepts all suggestions and clears individual ones", async () => {
    const m = await repo.addStaff({ name: "Rus", email: "rus@notify.test" });
    await repo.createSuggestedAssignments([
      { shiftId: shiftIds[0]!, staffMemberId: m.id },
      { shiftId: shiftIds[1]!, staffMemberId: m.id },
    ]);

    // Clear one suggestion.
    await repo.clearSuggestion(shiftIds[0]!, m.id);
    let mine = (await repo.listAssignments(periodId)).filter(
      (x) => x.staffMemberId === m.id,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.shiftId).toBe(shiftIds[1]);

    // Accept all remaining.
    const accepted = await repo.acceptAllSuggestions(periodId);
    expect(accepted).toBeGreaterThanOrEqual(1);
    mine = (await repo.listAssignments(periodId)).filter(
      (x) => x.staffMemberId === m.id,
    );
    expect(mine.every((x) => x.status === "confirmed")).toBe(true);
  });

  it("confirming via assign() promotes an existing suggestion", async () => {
    const m = await repo.addStaff({ name: "Tia", email: "tia@notify.test" });
    await repo.createSuggestedAssignments([
      { shiftId: shiftIds[1]!, staffMemberId: m.id },
    ]);
    await repo.assign(shiftIds[1]!, m.id);
    const mine = (await repo.listAssignments(periodId)).filter(
      (x) => x.staffMemberId === m.id,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.status).toBe("confirmed");
  });

  it("finds the most recently published period as the draft template", async () => {
    // No other published period yet for a fresh second period.
    const newer = await repo.createPeriod({
      label: "Next week",
      startDate: "2025-06-16",
      endDate: "2025-06-16",
    });
    expect(await repo.getLastPublishedPeriod(newer.id)).toBeNull();

    // Publish the original period; now it's the template for the newer one.
    await repo.publish(periodId, `slug-${Date.now()}`);
    const last = await repo.getLastPublishedPeriod(newer.id);
    expect(last?.id).toBe(periodId);

    // And a period excludes itself.
    expect(await repo.getLastPublishedPeriod(periodId)).toBeNull();
  });
});
