import { describe, expect, it } from "vitest";
import { buildTimesheetLines } from "@/lib/xero/timesheet-lines";

/** Pure aggregation (#16): approved closed entries → per-day 2.0 lines within a
 * Xero pay period. Business-local days, 2dp hours, period-bounded, open skipped. */

const TZ = "Australia/Sydney";

function at(iso: string): Date {
  return new Date(iso);
}

describe("buildTimesheetLines", () => {
  it("buckets hours by business-local day, summing multiple entries", () => {
    const { lines, totalHours } = buildTimesheetLines({
      timezone: TZ,
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
      entries: [
        // Mon 6 Jul: 09:00–12:00 + 13:00–17:00 (Sydney) = 3 + 4 = 7h
        {
          clockInAt: at("2026-07-05T23:00:00Z"),
          clockOutAt: at("2026-07-06T02:00:00Z"),
        },
        {
          clockInAt: at("2026-07-06T03:00:00Z"),
          clockOutAt: at("2026-07-06T07:00:00Z"),
        },
        // Tue 7 Jul: 4.5h
        {
          clockInAt: at("2026-07-06T23:00:00Z"),
          clockOutAt: at("2026-07-07T03:30:00Z"),
        },
      ],
    });
    expect(lines).toEqual([
      { date: "2026-07-06", numberOfUnits: 7 },
      { date: "2026-07-07", numberOfUnits: 4.5 },
    ]);
    expect(totalHours).toBe(11.5);
  });

  it("excludes entries whose local day is outside the period", () => {
    const { lines } = buildTimesheetLines({
      timezone: TZ,
      periodStart: "2026-07-06",
      periodEnd: "2026-07-06",
      entries: [
        {
          clockInAt: at("2026-07-06T00:00:00Z"),
          clockOutAt: at("2026-07-06T02:00:00Z"),
        }, // 6 Jul local
        {
          clockInAt: at("2026-07-07T00:00:00Z"),
          clockOutAt: at("2026-07-07T02:00:00Z"),
        }, // 7 Jul local → out
      ],
    });
    expect(lines.map((l) => l.date)).toEqual(["2026-07-06"]);
  });

  it("uses the business-LOCAL date, not the UTC date (tz boundary)", () => {
    // 2026-07-06T23:30Z is 2026-07-07 09:30 in Sydney → belongs to 7 Jul local.
    const { lines } = buildTimesheetLines({
      timezone: TZ,
      periodStart: "2026-07-07",
      periodEnd: "2026-07-07",
      entries: [
        {
          clockInAt: at("2026-07-06T23:30:00Z"),
          clockOutAt: at("2026-07-07T01:30:00Z"),
        },
      ],
    });
    expect(lines).toEqual([{ date: "2026-07-07", numberOfUnits: 2 }]);
  });

  it("counts open entries as skipped (no duration), never guessed", () => {
    const { lines, skippedOpen, totalHours } = buildTimesheetLines({
      timezone: TZ,
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
      entries: [
        { clockInAt: at("2026-07-06T00:00:00Z"), clockOutAt: null },
        {
          clockInAt: at("2026-07-06T01:00:00Z"),
          clockOutAt: at("2026-07-06T03:00:00Z"),
        },
      ],
    });
    expect(skippedOpen).toBe(1);
    expect(lines).toEqual([{ date: "2026-07-06", numberOfUnits: 2 }]);
    expect(totalHours).toBe(2);
  });

  it("rounds to 2dp per day (matching the CSV/report)", () => {
    const { lines } = buildTimesheetLines({
      timezone: TZ,
      periodStart: "2026-07-06",
      periodEnd: "2026-07-06",
      entries: [
        // 20 minutes = 0.33h (rounded)
        {
          clockInAt: at("2026-07-06T00:00:00Z"),
          clockOutAt: at("2026-07-06T00:20:00Z"),
        },
      ],
    });
    expect(lines[0]!.numberOfUnits).toBe(0.33);
  });
});
