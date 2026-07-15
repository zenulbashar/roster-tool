import { describe, it, expect } from "vitest";
import {
  clockState,
  elapsedMs,
  entryDurationMs,
  formatElapsed,
  weeklyTotalsByStaff,
} from "@/lib/clock";
import { businessDateOf } from "@/lib/time";

describe("clockState", () => {
  it("is 'out' with no entry", () => {
    expect(clockState(null)).toBe("out");
  });
  it("is 'in' for an open entry, 'out' for a closed one", () => {
    expect(clockState({ clockOutAt: null })).toBe("in");
    expect(clockState({ clockOutAt: new Date() })).toBe("out");
  });
});

describe("durations", () => {
  const start = new Date("2026-06-08T00:00:00Z");

  it("elapsedMs clamps negatives to zero", () => {
    const before = new Date("2026-06-07T23:00:00Z");
    expect(elapsedMs(start, before)).toBe(0);
    expect(elapsedMs(start, new Date("2026-06-08T01:00:00Z"))).toBe(3_600_000);
  });

  it("entryDurationMs uses clock-out, or now for an open entry", () => {
    const closed = {
      clockInAt: start,
      clockOutAt: new Date("2026-06-08T08:30:00Z"),
    };
    expect(entryDurationMs(closed)).toBe(8.5 * 3_600_000);

    const open = { clockInAt: start, clockOutAt: null };
    const now = new Date("2026-06-08T02:00:00Z");
    expect(entryDurationMs(open, now)).toBe(2 * 3_600_000);
  });

  it("entryDurationMs subtracts an unpaid break, clamped at zero", () => {
    const closed = {
      clockInAt: start,
      clockOutAt: new Date("2026-06-08T08:30:00Z"), // 8.5h gross
    };
    // 30-min break → 8h net; 60-min break → 7.5h net.
    expect(entryDurationMs(closed, undefined, 30)).toBe(8 * 3_600_000);
    expect(entryDurationMs(closed, undefined, 60)).toBe(7.5 * 3_600_000);
    // A break longer than the span never goes negative.
    const short = {
      clockInAt: start,
      clockOutAt: new Date("2026-06-08T00:20:00Z"), // 20 min gross
    };
    expect(entryDurationMs(short, undefined, 30)).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("formats hours and minutes", () => {
    expect(formatElapsed(0)).toBe("0m");
    expect(formatElapsed(59_000)).toBe("0m");
    expect(formatElapsed(60_000)).toBe("1m");
    expect(formatElapsed(3_600_000)).toBe("1h 0m");
    expect(formatElapsed(3_600_000 + 12 * 60_000)).toBe("1h 12m");
  });
});

describe("weeklyTotalsByStaff", () => {
  it("sums per staff member, counting open entries up to now", () => {
    const now = new Date("2026-06-08T10:00:00Z");
    const totals = weeklyTotalsByStaff(
      [
        {
          staffMemberId: "a",
          clockInAt: new Date("2026-06-08T00:00:00Z"),
          clockOutAt: new Date("2026-06-08T04:00:00Z"), // 4h
        },
        {
          staffMemberId: "a",
          clockInAt: new Date("2026-06-08T09:00:00Z"),
          clockOutAt: null, // open: 1h up to now
        },
        {
          staffMemberId: "b",
          clockInAt: new Date("2026-06-08T08:00:00Z"),
          clockOutAt: new Date("2026-06-08T10:00:00Z"), // 2h
        },
      ],
      now,
    );
    expect(totals.get("a")).toBe(5 * 3_600_000);
    expect(totals.get("b")).toBe(2 * 3_600_000);
  });
});

describe("businessDateOf", () => {
  it("returns the local calendar date in the business timezone", () => {
    // 22:00Z on the 7th is 08:00 on the 8th in Sydney (UTC+10).
    const instant = new Date("2026-06-07T22:00:00Z");
    expect(businessDateOf(instant, "Australia/Sydney")).toBe("2026-06-08");
    expect(businessDateOf(instant, "UTC")).toBe("2026-06-07");
  });
});
