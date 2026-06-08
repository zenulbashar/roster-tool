import { describe, it, expect } from "vitest";
import {
  hashPin,
  verifyPin,
  isValidPinFormat,
  isLockedOut,
  registerFailedAttempt,
  clearedLockout,
  MAX_PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  type LockoutState,
} from "@/lib/pin";

describe("PIN format", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPinFormat("0000")).toBe(true);
    expect(isValidPinFormat("4821")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const bad of ["", "123", "12345", "12a4", "abcd", " 123", "12 4"]) {
      expect(isValidPinFormat(bad)).toBe(false);
    }
  });
});

describe("PIN hashing", () => {
  it("verifies the correct PIN and rejects a wrong one", () => {
    const stored = hashPin("4821");
    expect(verifyPin("4821", stored)).toBe(true);
    expect(verifyPin("4822", stored)).toBe(false);
  });

  it("uses a random salt (same PIN hashes differently)", () => {
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
  });

  it("stores neither the PIN nor a recognisable form of it", () => {
    const stored = hashPin("1234");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("1234");
  });

  it("treats a null/garbage stored value as a non-match", () => {
    expect(verifyPin("1234", null)).toBe(false);
    expect(verifyPin("1234", "not-a-hash")).toBe(false);
    expect(verifyPin("1234", "scrypt$$")).toBe(false);
  });
});

describe("PIN lockout", () => {
  const fresh: LockoutState = { failedPinAttempts: 0, pinLockedUntil: null };
  const now = new Date("2026-06-08T10:00:00Z");

  it("is not locked with a clean slate", () => {
    expect(isLockedOut(fresh, now).locked).toBe(false);
  });

  it("locks only on the Nth wrong attempt", () => {
    let state = fresh;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      state = registerFailedAttempt(state, now);
      expect(isLockedOut(state, now).locked).toBe(false);
      expect(state.failedPinAttempts).toBe(i);
    }
    // The MAX-th failure trips the cooldown and resets the counter.
    state = registerFailedAttempt(state, now);
    const status = isLockedOut(state, now);
    expect(status.locked).toBe(true);
    expect(status.retryAfterMs).toBe(PIN_LOCKOUT_MS);
    expect(state.failedPinAttempts).toBe(0);
  });

  it("lifts the lock once the cooldown elapses", () => {
    let state = fresh;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      state = registerFailedAttempt(state, now);
    }
    const later = new Date(now.getTime() + PIN_LOCKOUT_MS + 1);
    expect(isLockedOut(state, later).locked).toBe(false);
  });

  it("clears state after a correct PIN", () => {
    expect(clearedLockout()).toEqual({
      failedPinAttempts: 0,
      pinLockedUntil: null,
    });
  });
});
