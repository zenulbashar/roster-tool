import { describe, expect, it } from "vitest";
import {
  attemptIdempotencyKey,
  baseIdempotencyKey,
} from "@/lib/xero/idempotency";

/**
 * The per-attempt idempotency key (#16). The load-bearing safety property: the
 * key VARIES per create attempt, so a replay after a delete-then-recreate can't
 * return Xero's cached response for the now-deleted timesheet — while a retry of
 * the SAME attempt reuses the same key (correct de-dupe).
 */

const IDS = {
  businessId: "biz-1",
  staffMemberId: "staff-1",
  periodStart: "2026-07-06",
  periodEnd: "2026-07-19",
};

describe("xero idempotency keys", () => {
  it("base is deterministic and stable across attempts", () => {
    expect(baseIdempotencyKey(IDS)).toBe(baseIdempotencyKey(IDS));
  });

  it("base differs when any identifying input differs", () => {
    const base = baseIdempotencyKey(IDS);
    expect(baseIdempotencyKey({ ...IDS, staffMemberId: "staff-2" })).not.toBe(
      base,
    );
    expect(baseIdempotencyKey({ ...IDS, periodStart: "2026-07-05" })).not.toBe(
      base,
    );
    expect(baseIdempotencyKey({ ...IDS, periodEnd: "2026-07-20" })).not.toBe(
      base,
    );
    expect(baseIdempotencyKey({ ...IDS, businessId: "biz-2" })).not.toBe(base);
  });

  it("the SAME attempt yields the SAME key (a network retry de-dupes)", () => {
    const base = baseIdempotencyKey(IDS);
    expect(attemptIdempotencyKey(base, 1)).toBe(attemptIdempotencyKey(base, 1));
    expect(attemptIdempotencyKey(base, 3)).toBe(attemptIdempotencyKey(base, 3));
  });

  it("a DIFFERENT attempt yields a DIFFERENT key (post-delete recreate is safe)", () => {
    const base = baseIdempotencyKey(IDS);
    const a1 = attemptIdempotencyKey(base, 1);
    const a2 = attemptIdempotencyKey(base, 2);
    const a3 = attemptIdempotencyKey(base, 3);
    expect(new Set([a1, a2, a3]).size).toBe(3);
    // And none of them equals the bare base (attempt is actually mixed in).
    expect(a1).not.toBe(base);
  });

  it("rejects a non-positive / non-integer attempt (never send a bad key)", () => {
    const base = baseIdempotencyKey(IDS);
    expect(() => attemptIdempotencyKey(base, 0)).toThrow();
    expect(() => attemptIdempotencyKey(base, -1)).toThrow();
    expect(() => attemptIdempotencyKey(base, 1.5)).toThrow();
  });
});
