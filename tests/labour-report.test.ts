import { describe, it, expect } from "vitest";
import {
  addDays,
  mondayOf,
  resolveWindow,
  entryHours,
  aggregateLabour,
  formatAudCents,
  type ReportEntry,
} from "@/lib/labour-report";

const TZ = "Australia/Sydney";

/**
 * Pure unit coverage for the hours & labour-cost reporting maths. No DB. Anchors
 * (June 2026): Mondays 18/05, 25/05, 01/06, 08/06, 15/06; "today" 09/06 (Tue)
 * → week-of-Monday 08/06. Sydney is UTC+10 in June.
 */
describe("labour-report: calendar helpers", () => {
  it("addDays does tz-independent calendar math across a month boundary", () => {
    expect(addDays("2026-06-08", -21)).toBe("2026-05-18");
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
  });

  it("mondayOf returns the ISO-week Monday (Monday maps to itself)", () => {
    expect(mondayOf("2026-06-09")).toBe("2026-06-08"); // Tue → Mon
    expect(mondayOf("2026-06-08")).toBe("2026-06-08"); // Mon → Mon
    expect(mondayOf("2026-06-07")).toBe("2026-06-01"); // Sun → previous Mon
  });
});

describe("labour-report: resolveWindow", () => {
  it("current week is [thisMonday, +7) with a single week", () => {
    const w = resolveWindow("current", { today: "2026-06-09" });
    expect(w).toMatchObject({
      preset: "current",
      startDate: "2026-06-08",
      endDate: "2026-06-15",
      weeks: ["2026-06-08"],
    });
  });

  it("last4 spans four ISO weeks ending with the current week", () => {
    const w = resolveWindow("last4", { today: "2026-06-09" });
    expect(w.preset).toBe("last4");
    expect(w.startDate).toBe("2026-05-18");
    expect(w.endDate).toBe("2026-06-15");
    expect(w.weeks).toEqual([
      "2026-05-18",
      "2026-05-25",
      "2026-06-01",
      "2026-06-08",
    ]);
  });

  it("custom range is inclusive of `to` and lists every week it touches", () => {
    const single = resolveWindow("custom", {
      today: "2026-06-09",
      from: "2026-06-01",
      to: "2026-06-07",
    });
    expect(single).toMatchObject({
      preset: "custom",
      startDate: "2026-06-01",
      endDate: "2026-06-08",
      weeks: ["2026-06-01"],
    });

    const crossing = resolveWindow("custom", {
      today: "2026-06-09",
      from: "2026-06-07",
      to: "2026-06-09",
    });
    expect(crossing.endDate).toBe("2026-06-10");
    expect(crossing.weeks).toEqual(["2026-06-01", "2026-06-08"]);
  });

  it("falls back to the current week for bad custom input", () => {
    const reversed = resolveWindow("custom", {
      today: "2026-06-09",
      from: "2026-06-10",
      to: "2026-06-01",
    });
    expect(reversed.preset).toBe("current");
    expect(reversed.startDate).toBe("2026-06-08");

    const malformed = resolveWindow("custom", {
      today: "2026-06-09",
      from: "nope",
      to: "2026-06-01",
    });
    expect(malformed.preset).toBe("current");

    const missing = resolveWindow("custom", { today: "2026-06-09" });
    expect(missing.preset).toBe("current");

    const tooWide = resolveWindow("custom", {
      today: "2026-06-09",
      from: "2024-01-01",
      to: "2026-06-01",
    });
    expect(tooWide.preset).toBe("current");
  });
});

describe("labour-report: entryHours", () => {
  it("returns 2dp worked hours for a closed entry", () => {
    expect(
      entryHours(
        new Date("2026-06-08T09:00:00Z"),
        new Date("2026-06-08T17:00:00Z"),
      ),
    ).toBe(8);
    // 1h 1m → 1.0166.. → 1.02 (2dp).
    expect(
      entryHours(
        new Date("2026-06-08T09:00:00Z"),
        new Date("2026-06-08T10:01:00Z"),
      ),
    ).toBe(1.02);
  });

  it("returns null for an open entry and 0 for non-positive duration", () => {
    expect(entryHours(new Date("2026-06-08T09:00:00Z"), null)).toBeNull();
    expect(
      entryHours(
        new Date("2026-06-08T17:00:00Z"),
        new Date("2026-06-08T17:00:00Z"),
      ),
    ).toBe(0);
    expect(
      entryHours(
        new Date("2026-06-08T17:00:00Z"),
        new Date("2026-06-08T09:00:00Z"),
      ),
    ).toBe(0);
  });
});

/** Build a ReportEntry with sensible defaults. */
function entry(
  over: Partial<ReportEntry> & Pick<ReportEntry, "clockInAt">,
): ReportEntry {
  return {
    staffMemberId: "s1",
    staffName: "Ava",
    payRateCents: 2550,
    rateType: "flat",
    rateLabel: null,
    clockOutAt: null,
    approved: true,
    ...over,
  };
}

describe("labour-report: aggregateLabour", () => {
  const window = resolveWindow("last4", { today: "2026-06-09" });

  it("sums approved hours and per-entry cost; cost matches hours x rate", () => {
    const entries = [
      entry({
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T08:00:00Z"), // 8h
      }),
      entry({
        clockInAt: new Date("2026-06-09T00:00:00Z"),
        clockOutAt: new Date("2026-06-09T04:00:00Z"), // 4h
      }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    const ava = report.perStaff[0]!;
    expect(ava.approvedHours).toBe(12);
    expect(ava.approvedEntryCount).toBe(2);
    expect(ava.avgHoursPerEntry).toBe(6);
    // 8h*2550 + 4h*2550 = 30600 cents.
    expect(ava.estCostCents).toBe(30600);
    expect(report.totals.estCostCents).toBe(30600);
    expect(report.totals.approvedHours).toBe(12);
  });

  it("splits approved (costed) from pending (uncosted) hours", () => {
    const entries = [
      entry({
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T08:00:00Z"),
        approved: true,
      }),
      entry({
        clockInAt: new Date("2026-06-09T00:00:00Z"),
        clockOutAt: new Date("2026-06-09T05:00:00Z"),
        approved: false, // pending
      }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    const ava = report.perStaff[0]!;
    expect(ava.approvedHours).toBe(8);
    expect(ava.pendingHours).toBe(5);
    expect(ava.estCostCents).toBe(8 * 2550); // pending not costed
    expect(report.totals.pendingHours).toBe(5);
  });

  it("counts hours but NULL cost for staff with no rate set, and flags them", () => {
    const entries = [
      entry({
        staffMemberId: "s2",
        staffName: "Ben",
        payRateCents: null,
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T06:00:00Z"),
      }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    const ben = report.perStaff[0]!;
    expect(ben.hasRate).toBe(false);
    expect(ben.approvedHours).toBe(6);
    expect(ben.estCostCents).toBeNull();
    expect(report.totals.staffWithoutRateCount).toBe(1);
    expect(report.totals.estCostCents).toBe(0);
  });

  it("excludes open entries from hours and counts them separately", () => {
    const entries = [
      entry({
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T08:00:00Z"),
      }),
      entry({ clockInAt: new Date("2026-06-09T00:00:00Z"), clockOutAt: null }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    expect(report.perStaff[0]!.approvedHours).toBe(8);
    expect(report.totals.openEntryCount).toBe(1);
  });

  it("buckets by business-local week, including the tz week boundary", () => {
    const entries = [
      // Sun 23:30 UTC = Mon 09:30 Sydney → belongs to the 08/06 week, NOT 01/06.
      entry({
        clockInAt: new Date("2026-06-07T23:30:00Z"),
        clockOutAt: new Date("2026-06-08T03:30:00Z"), // 4h
      }),
      // Mon 01/06 10:00 Sydney → 01/06 week.
      entry({
        clockInAt: new Date("2026-06-01T00:00:00Z"),
        clockOutAt: new Date("2026-06-01T02:00:00Z"), // 2h
      }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    const byWeek = Object.fromEntries(
      report.weekly.map((w) => [w.weekStart, w.approvedHours]),
    );
    expect(byWeek["2026-06-08"]).toBe(4);
    expect(byWeek["2026-06-01"]).toBe(2);
  });

  it("lists every week in the window, with zeros where nothing was worked", () => {
    const entries = [
      entry({
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T03:00:00Z"),
      }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    expect(report.weekly.map((w) => w.weekStart)).toEqual([
      "2026-05-18",
      "2026-05-25",
      "2026-06-01",
      "2026-06-08",
    ]);
    expect(
      report.weekly.find((w) => w.weekStart === "2026-05-25"),
    ).toMatchObject({
      approvedHours: 0,
      estCostCents: 0,
      approvedEntryCount: 0,
    });
  });

  it("returns per-staff rows sorted by name", () => {
    const entries = [
      entry({
        staffMemberId: "s2",
        staffName: "Zoe",
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T01:00:00Z"),
      }),
      entry({
        staffMemberId: "s1",
        staffName: "Ava",
        clockInAt: new Date("2026-06-08T00:00:00Z"),
        clockOutAt: new Date("2026-06-08T01:00:00Z"),
      }),
    ];
    const report = aggregateLabour(entries, window, TZ);
    expect(report.perStaff.map((s) => s.staffName)).toEqual(["Ava", "Zoe"]);
  });
});

describe("labour-report: formatAudCents", () => {
  it("formats cents as AUD currency", () => {
    expect(formatAudCents(123456)).toBe("$1,234.56");
    expect(formatAudCents(0)).toBe("$0.00");
  });
});
