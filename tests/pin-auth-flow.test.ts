import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { hashPin, MAX_PIN_ATTEMPTS } from "@/lib/pin";
import {
  authenticateStaffPin,
  PIN_DEVICE_LIMIT_MESSAGE,
  PIN_MISMATCH_MESSAGE,
  PIN_SHAPE_MESSAGE,
} from "@/lib/pin-auth";
import { PIN_ATTEMPT_LIMITS } from "@/lib/rate-limit";

/**
 * SEC-06 / SEC-07 against the real DB: the shared PIN core enforces the
 * per-staff escalating lockout, the per-DEVICE attempt ceiling (which is what
 * stops one bad actor locking a whole venue out), generic errors, and async
 * verification of legacy 4-digit hashes.
 */
describe("authenticateStaffPin (shared PIN core)", () => {
  let businessId = "";
  let repo: TenantRepo;
  let ava = "";
  let ben = "";
  let noPin = "";
  const now = new Date("2026-06-08T10:00:00Z");

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "PIN Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
    ava = (await repo.addStaff({ name: "Ava", email: "ava@pin.test" })).id;
    ben = (await repo.addStaff({ name: "Ben", email: "ben@pin.test" })).id;
    noPin = (await repo.addStaff({ name: "Cam", email: "cam@pin.test" })).id;
    await repo.setStaffPin(ava, hashPin("4821")); // legacy 4-digit
    await repo.setStaffPin(ben, hashPin("735019")); // new 6-digit
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
  });

  it("accepts the right PIN (4- and 6-digit) and returns the staff member", async () => {
    const a = await authenticateStaffPin(repo, {
      staffId: ava,
      pin: "4821",
      now,
    });
    expect(a.ok && a.staff.id).toBe(ava);
    const b = await authenticateStaffPin(repo, {
      staffId: ben,
      pin: "735019",
      now,
    });
    expect(b.ok && b.staff.id).toBe(ben);
  });

  it("uses one generic message for wrong, PIN-less, unknown and malformed", async () => {
    const wrong = await authenticateStaffPin(repo, {
      staffId: ava,
      pin: "0000",
      now,
    });
    const none = await authenticateStaffPin(repo, {
      staffId: noPin,
      pin: "4821",
      now,
    });
    const unknown = await authenticateStaffPin(repo, {
      staffId: "00000000-0000-0000-0000-000000000000",
      pin: "4821",
      now,
    });
    expect(wrong).toEqual({ ok: false, message: PIN_MISMATCH_MESSAGE });
    expect(none).toEqual({ ok: false, message: PIN_MISMATCH_MESSAGE });
    expect(unknown).toEqual({ ok: false, message: PIN_MISMATCH_MESSAGE });
    const shape = await authenticateStaffPin(repo, {
      staffId: ava,
      pin: "12",
      now,
    });
    expect(shape).toEqual({ ok: false, message: PIN_SHAPE_MESSAGE });
  });

  it("locks the person after N wrong PINs, escalates, and only a correct PIN resets", async () => {
    // 4 wrong so far (from the test above: 1). Reach the batch boundary.
    for (let i = 0; i < MAX_PIN_ATTEMPTS - 2; i++) {
      await authenticateStaffPin(repo, { staffId: ava, pin: "0001", now });
    }
    const locking = await authenticateStaffPin(repo, {
      staffId: ava,
      pin: "0002",
      now,
    });
    expect(locking.ok).toBe(false);
    expect((locking as { message: string }).message).toMatch(/wait 60s/);

    // Still locked — even the RIGHT PIN is refused during the cooldown.
    const during = await authenticateStaffPin(repo, {
      staffId: ava,
      pin: "4821",
      now: new Date(now.getTime() + 30_000),
    });
    expect(during.ok).toBe(false);

    // After the minute: 5 more wrong → the SECOND ladder step (5 minutes).
    const later = new Date(now.getTime() + 61_000);
    let res = null as Awaited<ReturnType<typeof authenticateStaffPin>> | null;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      res = await authenticateStaffPin(repo, {
        staffId: ava,
        pin: "0003",
        now: later,
      });
    }
    expect(res!.ok).toBe(false);
    expect((res as { message: string }).message).toMatch(/wait 5 minutes/);

    // A correct PIN once the lock lifts clears everything.
    const cleared = await authenticateStaffPin(repo, {
      staffId: ava,
      pin: "4821",
      now: new Date(later.getTime() + 5 * 60_000 + 1),
    });
    expect(cleared.ok).toBe(true);
    const row = await repo.getStaff(ava);
    expect(row!.failedPinAttempts).toBe(0);
    expect(row!.pinLockedUntil).toBeNull();
  });

  it("caps attempts per DEVICE regardless of which staff member is targeted", async () => {
    const deviceKey = `test-device-${process.pid}-${Date.now()}`;
    const perMinute = PIN_ATTEMPT_LIMITS[0].max;
    // Target people who never accrue per-staff failures (no PIN set / unknown
    // id): the per-staff lockout can't trip, but the DEVICE ceiling does —
    // this is what stops one bad actor locking a whole venue out.
    let last = null as Awaited<ReturnType<typeof authenticateStaffPin>> | null;
    for (let i = 0; i < perMinute + 1; i++) {
      last = await authenticateStaffPin(repo, {
        staffId: i % 2 === 0 ? noPin : "00000000-0000-0000-0000-000000000000",
        pin: "111111",
        deviceKey,
        now,
      });
    }
    expect(last).toEqual({ ok: false, message: PIN_DEVICE_LIMIT_MESSAGE });
    // The right PIN from the same exhausted device is refused too — the cap
    // is on the device, not the answer.
    const right = await authenticateStaffPin(repo, {
      staffId: ben,
      pin: "735019",
      deviceKey,
      now,
    });
    expect(right).toEqual({ ok: false, message: PIN_DEVICE_LIMIT_MESSAGE });
    // A different device is unaffected.
    const other = await authenticateStaffPin(repo, {
      staffId: ben,
      pin: "735019",
      deviceKey: `${deviceKey}-other`,
      now,
    });
    expect(other.ok).toBe(true);
  });
});
