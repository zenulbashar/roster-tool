import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { handleStaffShiftReminders } from "@/lib/jobs/handlers";

/**
 * Integration coverage for the daily IN-APP shift reminder sweep. Requires a
 * local Postgres (see CI / README).
 *
 * `now` is fixed at 2026-06-10T12:00Z (22:00 in Australia/Sydney, the default
 * business timezone) so "tomorrow" is deterministically 2026-06-11. The seed
 * exercises every exclusion: a suggested (unconfirmed) assignment, a shift on
 * a different day, a confirmed shift in an UNPUBLISHED period, an inactive
 * staff member, and a business that turned reminders off. The handler sends
 * no email by construction — it never touches the mailer.
 */
const NOW = new Date("2026-06-10T12:00:00Z");
const TOMORROW = "2026-06-11";

describe("staff shift reminder job", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let ava = "";
  let ben = "";
  let ivy = ""; // inactive
  let zoe = ""; // business B (reminders off)

  async function seedPublishedShift(
    repo: TenantRepo,
    staffId: string,
    opts: { date?: string; label?: string; publish?: boolean; start?: string },
  ) {
    const period = await repo.createPeriod({
      label: `Wk ${opts.label ?? "x"}`,
      startDate: "2026-06-08",
      endDate: "2026-06-14",
    });
    const [shift] = await repo.createShifts([
      {
        rosterPeriodId: period.id,
        date: opts.date ?? TOMORROW,
        label: opts.label ?? "Morning",
        startTime: opts.start ?? "08:00",
        endTime: "14:00",
      },
    ]);
    await repo.assign(shift!.id, staffId);
    if (opts.publish !== false) {
      await repo.publish(period.id, `slug-${period.id.slice(0, 8)}`);
      await repo.updatePeriod(period.id, { status: "published" });
    }
    return { period, shift: shift! };
  }

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Reminder Biz A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Reminder Biz B", staffShiftRemindersEnabled: false })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    const repoB = createTenantRepo(businessB);

    ava = (await repoA.addStaff({ name: "Ava", email: "ava@rem-a.test" })).id;
    ben = (await repoA.addStaff({ name: "Ben", email: "ben@rem-a.test" })).id;
    ivy = (await repoA.addStaff({ name: "Ivy", email: "ivy@rem-a.test" })).id;
    zoe = (await repoB.addStaff({ name: "Zoe", email: "zoe@rem-b.test" })).id;

    // Ava: TWO confirmed published shifts tomorrow → one combined reminder.
    const first = await seedPublishedShift(repoA, ava, { label: "Morning" });
    const [evening] = await repoA.createShifts([
      {
        rosterPeriodId: first.period.id,
        date: TOMORROW,
        label: "Evening",
        startTime: "17:00",
        endTime: "21:00",
      },
    ]);
    await repoA.assign(evening!.id, ava);

    // Ava also works a DIFFERENT day (no reminder for it).
    const [otherDay] = await repoA.createShifts([
      {
        rosterPeriodId: first.period.id,
        date: "2026-06-13",
        label: "Weekend",
        startTime: "09:00",
        endTime: "15:00",
      },
    ]);
    await repoA.assign(otherDay!.id, ava);

    // Ben: only a SUGGESTED assignment tomorrow → no reminder.
    const [suggested] = await repoA.createShifts([
      {
        rosterPeriodId: first.period.id,
        date: TOMORROW,
        label: "Maybe",
        startTime: "10:00",
        endTime: "16:00",
      },
    ]);
    await repoA.createSuggestedAssignments([
      { shiftId: suggested!.id, staffMemberId: ben },
    ]);

    // Ben: a confirmed shift tomorrow in an UNPUBLISHED period → no reminder.
    await seedPublishedShift(repoA, ben, { label: "Drafty", publish: false });

    // Ivy is inactive despite a confirmed published shift tomorrow.
    await seedPublishedShift(repoA, ivy, { label: "Ghost" });
    await repoA.updateStaff(ivy, { active: false });

    // Zoe (business B): qualifies fully, but reminders are OFF for B.
    await seedPublishedShift(repoB, zoe, { label: "Muted" });
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
  });

  it("reminds exactly the confirmed, published, active, enabled set", async () => {
    const created = await handleStaffShiftReminders(NOW);
    expect(created).toBe(1); // Ava only

    const avas = await repoA.listStaffNotifications(ava);
    expect(avas).toHaveLength(1);
    expect(avas[0]!.type).toBe("shift_reminder");
    expect(avas[0]!.title).toBe("Reminder: you work tomorrow");
    // Both of tomorrow's shifts, neither the other day's.
    expect(avas[0]!.body).toContain("Morning");
    expect(avas[0]!.body).toContain("Evening");
    expect(avas[0]!.body).not.toContain("Weekend");

    expect(await repoA.listStaffNotifications(ben)).toHaveLength(0);
    expect(await repoA.listStaffNotifications(ivy)).toHaveLength(0);
    expect(
      await createTenantRepo(businessB).listStaffNotifications(zoe),
    ).toHaveLength(0);
  });

  it("re-running the same day is a no-op (idempotent)", async () => {
    expect(await handleStaffShiftReminders(NOW)).toBe(0);
    expect(await repoA.listStaffNotifications(ava)).toHaveLength(1);
  });

  it("the next day re-arms (a new date is a new dedupe key)", async () => {
    const created = await handleStaffShiftReminders(
      new Date("2026-06-11T12:00:00Z"), // tomorrow = 12/06: no shifts seeded
    );
    expect(created).toBe(0);
    // 12/06 has no shifts, so still just the one reminder — but prove the key
    // varies by running for the 13th, when Ava works.
    const forWeekend = await handleStaffShiftReminders(
      new Date("2026-06-12T12:00:00Z"), // tomorrow = 13/06: Ava's Weekend shift
    );
    expect(forWeekend).toBe(1);
    const avas = await repoA.listStaffNotifications(ava);
    expect(avas).toHaveLength(2);
  });
});
