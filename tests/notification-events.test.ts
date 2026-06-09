import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, users } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { hashPin } from "@/lib/pin";
import { submitStaffLeave } from "@/lib/leave-submission";
import { submitStockCheck } from "@/lib/stock-check-submission";
import { handleCertificationReminders } from "@/lib/jobs/handlers";

/**
 * Verifies notifications are CREATED at each in-scope event's source when the
 * type is enabled (the default), and SKIPPED when the owner has muted that type
 * — without changing the existing behaviour. Local Postgres (see PR notes).
 */
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("notification event wiring", () => {
  let businessId = "";
  let repo: TenantRepo;
  const created: string[] = [];

  beforeEach(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Event Café" })
      .returning();
    businessId = b!.id;
    created.push(businessId);
    repo = createTenantRepo(businessId);
  });

  afterAll(async () => {
    // Clean up so re-runs don't collide (owner email is unique) or accumulate.
    if (created.length > 0) {
      await db.delete(users).where(inArray(users.businessId, created));
      await db.delete(businesses).where(inArray(businesses.id, created));
    }
    await db.$client.end();
  });

  it("leave submission creates a leave_requested notification (gated by pref)", async () => {
    const staff = await repo.addStaff({ name: "Ava", email: "ava@e.test" });
    await repo.setStaffPin(staff.id, hashPin("1234"));

    const ok = await submitStaffLeave(
      repo,
      form({
        staffId: staff.id,
        pin: "1234",
        leaveType: "annual",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
      }),
    );
    expect(ok.status).toBe("success");

    const notes = await repo.listRecentNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("leave_requested");
    expect(notes[0]!.linkPath).toBe("/app/leave");
    expect(notes[0]!.title).toContain("Ava");

    // Mute the type → a second submission creates no further notification.
    await repo.updateNotificationPrefs({ notifyLeaveRequested: false });
    const ok2 = await submitStaffLeave(
      repo,
      form({
        staffId: staff.id,
        pin: "1234",
        leaveType: "sick",
        startDate: "2026-12-01",
        endDate: "2026-12-01",
      }),
    );
    expect(ok2.status).toBe("success"); // action still succeeds
    expect(await repo.listRecentNotifications()).toHaveLength(1);
  });

  it("stock check creates stock_needs_order only when something needs ordering", async () => {
    const staff = await repo.addStaff({ name: "Sam", email: "sam@e.test" });
    await repo.setStaffPin(staff.id, hashPin("1234"));
    const milk = await repo.addItem({ name: "Milk" });
    const beans = await repo.addItem({ name: "Beans" });

    // Marking only "available"/"low" → no needs-order notification.
    const okLow = await submitStockCheck(
      repo,
      form({ staffId: staff.id, pin: "1234", [`status_${milk.id}`]: "low" }),
    );
    expect(okLow.status).toBe("success");
    expect(await repo.listRecentNotifications()).toHaveLength(0);

    // Marking an item needs_order → one notification.
    const okNeeds = await submitStockCheck(
      repo,
      form({
        staffId: staff.id,
        pin: "1234",
        [`status_${beans.id}`]: "needs_order",
      }),
    );
    expect(okNeeds.status).toBe("success");
    const notes = await repo.listRecentNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("stock_needs_order");
    expect(notes[0]!.linkPath).toBe("/app/stock");
  });

  it("cert reminder job creates a cert_expiring notification when due", async () => {
    // An owner email recipient is required for the digest to run. Unique email
    // per run so repeated test runs against the same DB don't collide.
    await db
      .insert(users)
      .values({ email: `owner-${crypto.randomUUID()}@e.test`, businessId });
    const staff = await repo.addStaff({ name: "Cara", email: "cara@e.test" });
    // Expires today → due "expired" stage.
    const now = new Date("2026-06-09T02:00:00Z");
    await repo.addCertification({
      staffMemberId: staff.id,
      certType: "rsa",
      certLabel: null,
      referenceNumber: null,
      expiryDate: "2026-06-09",
    });

    const sent: unknown[] = [];
    await handleCertificationReminders(now, {
      send: async (e) => {
        sent.push(e);
      },
    });
    expect(sent.length).toBeGreaterThan(0); // email behaviour unchanged

    const notes = await repo.listRecentNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe("cert_expiring");
    expect(notes[0]!.linkPath).toBe("/app/certifications");
  });
});
