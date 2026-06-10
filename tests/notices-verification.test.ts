import { describe, it, expect } from "vitest";
import {
  makeNoticesVerification,
  checkNoticesVerification,
  NOTICES_VERIFICATION_TTL_MS,
} from "@/lib/notices-verification";

const SECRET = "test-secret";
const STAFF = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-06-10T10:00:00Z");

describe("notices verification proof", () => {
  it("accepts its own fresh proof for the same staff member", () => {
    const v = makeNoticesVerification(STAFF, SECRET, NOW);
    expect(checkNoticesVerification(v, STAFF, SECRET, NOW)).toBe(true);
    // Still valid just before expiry…
    expect(
      checkNoticesVerification(
        v,
        STAFF,
        SECRET,
        new Date(NOW.getTime() + NOTICES_VERIFICATION_TTL_MS - 1000),
      ),
    ).toBe(true);
  });

  it("expires after the TTL", () => {
    const v = makeNoticesVerification(STAFF, SECRET, NOW);
    expect(
      checkNoticesVerification(
        v,
        STAFF,
        SECRET,
        new Date(NOW.getTime() + NOTICES_VERIFICATION_TTL_MS),
      ),
    ).toBe(false);
  });

  it("is bound to ONE staff member", () => {
    const v = makeNoticesVerification(STAFF, SECRET, NOW);
    expect(
      checkNoticesVerification(v, "99999999-aaaa-bbbb-cccc-dddddddddddd", SECRET, NOW),
    ).toBe(false);
  });

  it("rejects a tampered payload or signature", () => {
    const v = makeNoticesVerification(STAFF, SECRET, NOW);
    const [id, expiry, mac] = v.split(".") as [string, string, string];
    // Stretch the expiry without re-signing.
    expect(
      checkNoticesVerification(
        `${id}.${Number(expiry) + 86_400_000}.${mac}`,
        STAFF,
        SECRET,
        NOW,
      ),
    ).toBe(false);
    // Bit-flip the signature.
    const flipped = mac.endsWith("A") ? `${mac.slice(0, -1)}B` : `${mac.slice(0, -1)}A`;
    expect(
      checkNoticesVerification(`${id}.${expiry}.${flipped}`, STAFF, SECRET, NOW),
    ).toBe(false);
  });

  it("rejects a proof signed with a different secret", () => {
    const v = makeNoticesVerification(STAFF, "other-secret", NOW);
    expect(checkNoticesVerification(v, STAFF, SECRET, NOW)).toBe(false);
  });

  it("rejects garbage and absence", () => {
    expect(checkNoticesVerification(undefined, STAFF, SECRET, NOW)).toBe(false);
    expect(checkNoticesVerification("", STAFF, SECRET, NOW)).toBe(false);
    expect(checkNoticesVerification("a.b", STAFF, SECRET, NOW)).toBe(false);
    expect(checkNoticesVerification("a.b.c.d", STAFF, SECRET, NOW)).toBe(false);
    expect(checkNoticesVerification(`${STAFF}.notanumber.xx`, STAFF, SECRET, NOW)).toBe(false);
  });
});
