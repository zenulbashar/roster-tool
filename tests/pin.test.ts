import { describe, it, expect } from "vitest";
import {
  hashPin,
  verifyPin,
  isValidPinFormat,
  isValidNewPin,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  lockoutDurationMs,
  waitText,
  MAX_PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  PIN_LOCKOUT_LADDER_MS,
  type LockoutState,
} from "@/lib/pin";

describe("PIN format (as entered)", () => {
  it("accepts four to six digits", () => {
    for (const ok of ["0000", "4821", "48210", "482103"]) {
      expect(isValidPinFormat(ok)).toBe(true);
    }
  });
  it("rejects anything else", () => {
    for (const bad of ["", "123", "1234567", "12a4", "abcd", " 123", "12 4"]) {
      expect(isValidPinFormat(bad)).toBe(false);
    }
  });
});

describe("new-PIN policy (SEC-06)", () => {
  it("accepts an ordinary PIN", () => {
    for (const ok of ["4821", "7350", "918273", "20481"]) {
      expect(isValidNewPin(ok)).toBe(true);
    }
  });
  it("rejects repeats, runs and the most-guessed PINs", () => {
    for (const bad of [
      "0000",
      "1111",
      "999999",
      "1234",
      "4321",
      "123456",
      "654321",
      "2345",
      "9876",
      "2580",
      "1212",
      "2000",
      "1998",
    ]) {
      expect(isValidNewPin(bad), bad).toBe(false);
    }
  });
  it("still rejects a malformed PIN", () => {
    expect(isValidNewPin("12")).toBe(false);
    expect(isValidNewPin("12a4")).toBe(false);
  });
});

describe("PIN hashing", () => {
  it("verifies the correct PIN and rejects a wrong one (async)", async () => {
    const stored = hashPin("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
  });

  it("verifies a six-digit PIN", async () => {
    const stored = hashPin("482103");
    expect(await verifyPin("482103", stored)).toBe(true);
    expect(await verifyPin("482100", stored)).toBe(false);
  });

  it("uses a random salt (same PIN hashes differently)", () => {
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
  });

  it("stores neither the PIN nor a recognisable form of it", () => {
    const stored = hashPin("1234");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("1234");
  });

  it("treats a null/garbage stored value as a non-match", async () => {
    expect(await verifyPin("1234", null)).toBe(false);
    expect(await verifyPin("1234", "not-a-hash")).toBe(false);
    expect(await verifyPin("1234", "scrypt$$")).toBe(false);
  });
});

describe("PIN lockout (escalating, cumulative)", () => {
  const fresh: LockoutState = { failedPinAttempts: 0, pinLockedUntil: null };
  const now = new Date("2026-06-08T10:00:00Z");

  function fail(state: LockoutState, times: number, at = now): LockoutState {
    for (let i = 0; i < times; i++) state = registerFailedAttempt(state, at);
    return state;
  }

  it("is not locked with a clean slate", () => {
    expect(isLockedOut(fresh, now).locked).toBe(false);
  });

  it("locks on the Nth wrong attempt for the first ladder step", () => {
    let state = fresh;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      state = registerFailedAttempt(state, now);
      expect(isLockedOut(state, now).locked).toBe(false);
      expect(state.failedPinAttempts).toBe(i);
    }
    state = registerFailedAttempt(state, now);
    const status = isLockedOut(state, now);
    expect(status.locked).toBe(true);
    expect(status.retryAfterMs).toBe(PIN_LOCKOUT_MS);
    // The counter is NOT reset by a lock — only by a correct PIN.
    expect(state.failedPinAttempts).toBe(MAX_PIN_ATTEMPTS);
  });

  it("escalates: each further batch of failures waits longer", () => {
    expect(lockoutDurationMs(5)).toBe(PIN_LOCKOUT_LADDER_MS[0]);
    expect(lockoutDurationMs(10)).toBe(PIN_LOCKOUT_LADDER_MS[1]);
    expect(lockoutDurationMs(15)).toBe(PIN_LOCKOUT_LADDER_MS[2]);
    expect(lockoutDurationMs(20)).toBe(PIN_LOCKOUT_LADDER_MS[3]);
    // Capped at the top of the ladder thereafter.
    expect(lockoutDurationMs(100)).toBe(PIN_LOCKOUT_LADDER_MS[3]);

    // Drive it: 5 failures → 1 min; after that lifts, 5 more → 5 min.
    let state = fail(fresh, 5);
    expect(isLockedOut(state, now).retryAfterMs).toBe(60_000);
    const later = new Date(now.getTime() + 60_000 + 1);
    expect(isLockedOut(state, later).locked).toBe(false);
    state = fail(state, 5, later);
    expect(isLockedOut(state, later).retryAfterMs).toBe(5 * 60_000);
    expect(state.failedPinAttempts).toBe(10);
  });

  it("the old flat ladder is gone: 33 hours of guessing no longer covers the keyspace", () => {
    // 10,000 PINs at the OLD rate (5/min forever) = ~33 h. Under the ladder,
    // 100 batches of 5 cost 1 + 5 + 15 + 97×60 minutes ≈ 4 days — and every
    // batch after the third costs an hour, so the expected time to a hit on a
    // 4-digit space is now measured in weeks, not hours.
    let total = 0;
    for (let batch = 1; batch <= 100; batch++)
      total += lockoutDurationMs(batch * MAX_PIN_ATTEMPTS);
    expect(total).toBeGreaterThan(4 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);
  });

  it("lifts the lock once the cooldown elapses", () => {
    const state = fail(fresh, MAX_PIN_ATTEMPTS);
    const later = new Date(now.getTime() + PIN_LOCKOUT_MS + 1);
    expect(isLockedOut(state, later).locked).toBe(false);
  });

  it("clears state after a correct PIN", () => {
    expect(clearedLockout()).toEqual({
      failedPinAttempts: 0,
      pinLockedUntil: null,
    });
  });

  it("describes the wait in human units", () => {
    expect(waitText(45_000)).toBe("45s");
    expect(waitText(5 * 60_000)).toBe("5 minutes");
    expect(waitText(60 * 60_000)).toBe("1 hour");
  });
});
