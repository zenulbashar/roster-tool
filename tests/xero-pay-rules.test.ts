import { describe, expect, it } from "vitest";
import {
  classifyEntries,
  describePayRuleCondition,
  mondayOfWeek,
  parsePayRuleCondition,
  toActivePayRules,
  type ActivePayRule,
  type PayRuleCondition,
} from "@/lib/xero/pay-rules";
import { buildTimesheetLines } from "@/lib/xero/timesheet-lines";

/**
 * The pure pay-classification evaluator. The load-bearing properties:
 *  - ZERO rules ⇒ output identical to the shipped `buildTimesheetLines` under
 *    the ordinary rate (strict backward compatibility);
 *  - conditions are evaluated on each worked MOMENT's local wall clock, with
 *    entries split at exactly the instants where an answer could change;
 *  - precedence is the owner's ordered list, first match wins per sub-block;
 *  - split lines per day ALWAYS sum to the same 2dp day total the CSV/report/
 *    M27 push produce (rounding remainder absorbed into the largest line).
 */

const TZ = "Australia/Sydney"; // UTC+10 in July (no DST)
const ORD = "rate-ordinary";

function at(iso: string): Date {
  return new Date(iso);
}

let seq = 0;
function rule(
  priority: number,
  condition: PayRuleCondition,
  overrides: Partial<ActivePayRule> = {},
): ActivePayRule {
  seq += 1;
  return {
    id: overrides.id ?? `rule-${seq}`,
    name: overrides.name ?? `Rule ${seq}`,
    priority,
    condition,
    earningsRateId: overrides.earningsRateId ?? `rate-${seq}`,
    earningsRateName: overrides.earningsRateName ?? `Pay item ${seq}`,
    ...overrides,
  };
}

function classify(
  entries: { clockInAt: Date; clockOutAt: Date | null }[],
  rules: ActivePayRule[],
  period: { start: string; end: string } = {
    start: "2026-07-06",
    end: "2026-07-12",
  },
) {
  return classifyEntries({
    entries,
    rules,
    ordinaryEarningsRateId: ORD,
    timezone: TZ,
    periodStart: period.start,
    periodEnd: period.end,
  });
}

describe("parsePayRuleCondition / toActivePayRules", () => {
  it("parses each valid config and rejects invalid ones", () => {
    expect(parsePayRuleCondition("day_of_week", { days: [6, 7] })).toEqual({
      type: "day_of_week",
      days: [6, 7],
    });
    expect(
      parsePayRuleCondition("time_of_day_after", { time: "22:00" }),
    ).toEqual({ type: "time_of_day_after", time: "22:00" });
    expect(parsePayRuleCondition("daily_hours_beyond", { hours: 8 })).toEqual({
      type: "daily_hours_beyond",
      hours: 8,
    });
    // Invalid: out-of-range day, malformed time, zero hours, wrong shape.
    expect(parsePayRuleCondition("day_of_week", { days: [0] })).toBeNull();
    expect(parsePayRuleCondition("day_of_week", { days: [] })).toBeNull();
    expect(
      parsePayRuleCondition("time_of_day_after", { time: "24:00" }),
    ).toBeNull();
    expect(
      parsePayRuleCondition("time_of_day_before", { time: "9pm" }),
    ).toBeNull();
    expect(
      parsePayRuleCondition("daily_hours_beyond", { hours: 0 }),
    ).toBeNull();
    expect(
      parsePayRuleCondition("weekly_hours_beyond", { hours: 200 }),
    ).toBeNull();
    expect(
      parsePayRuleCondition("daily_hours_beyond", { days: [1] }),
    ).toBeNull();
  });

  it("keeps active parsable rows in precedence order, drops the rest", () => {
    const rows = [
      {
        id: "b",
        name: "Second",
        priority: 2,
        isActive: true,
        conditionType: "day_of_week" as const,
        conditionConfig: { days: [6] },
        earningsRateId: "r2",
        earningsRateName: "Item 2",
      },
      {
        id: "a",
        name: "First",
        priority: 1,
        isActive: true,
        conditionType: "time_of_day_after" as const,
        conditionConfig: { time: "22:00" },
        earningsRateId: "r1",
        earningsRateName: "Item 1",
      },
      {
        id: "c",
        name: "Off",
        priority: 3,
        isActive: false, // inactive → dropped
        conditionType: "day_of_week" as const,
        conditionConfig: { days: [7] },
        earningsRateId: "r3",
        earningsRateName: "Item 3",
      },
      {
        id: "d",
        name: "Broken",
        priority: 4,
        isActive: true,
        conditionType: "day_of_week" as const,
        conditionConfig: { days: [99] }, // tampered config → inert
        earningsRateId: "r4",
        earningsRateName: "Item 4",
      },
    ];
    const active = toActivePayRules(rows);
    expect(active.map((r) => r.id)).toEqual(["a", "b"]);
    expect(active[0]!.condition).toEqual({
      type: "time_of_day_after",
      time: "22:00",
    });
  });
});

describe("describePayRuleCondition", () => {
  it("describes every condition type in plain words", () => {
    expect(describePayRuleCondition({ type: "day_of_week", days: [6] })).toBe(
      "Hours on Saturday",
    );
    expect(
      describePayRuleCondition({ type: "day_of_week", days: [7, 6, 1] }),
    ).toBe("Hours on Monday, Saturday & Sunday");
    expect(
      describePayRuleCondition({ type: "time_of_day_after", time: "22:00" }),
    ).toBe("Hours after 10 pm");
    expect(
      describePayRuleCondition({ type: "time_of_day_before", time: "06:30" }),
    ).toBe("Hours before 6:30 am");
    expect(
      describePayRuleCondition({ type: "daily_hours_beyond", hours: 8 }),
    ).toBe("Hours beyond 8 in a day");
    expect(
      describePayRuleCondition({ type: "weekly_hours_beyond", hours: 38 }),
    ).toBe("Hours beyond 38 in a week (Mon–Sun)");
  });
});

describe("mondayOfWeek", () => {
  it("returns the Monday of the ISO week", () => {
    expect(mondayOfWeek("2026-07-08")).toBe("2026-07-06"); // Wed → Mon
    expect(mondayOfWeek("2026-07-06")).toBe("2026-07-06"); // Mon → itself
    expect(mondayOfWeek("2026-07-12")).toBe("2026-07-06"); // Sun → same week's Mon
    expect(mondayOfWeek("2026-07-13")).toBe("2026-07-13"); // next Mon
  });
});

describe("classifyEntries — zero rules (backward compatibility)", () => {
  it("matches buildTimesheetLines exactly under the ordinary rate", () => {
    const entries = [
      // Mon 6 Jul: 09:00–12:00 + 13:00–17:00 (Sydney) = 7h
      {
        clockInAt: at("2026-07-05T23:00:00Z"),
        clockOutAt: at("2026-07-06T02:00:00Z"),
      },
      {
        clockInAt: at("2026-07-06T03:00:00Z"),
        clockOutAt: at("2026-07-06T07:00:00Z"),
      },
      // Tue 7 Jul: 4.5h; plus an open entry and a 20-minute entry
      {
        clockInAt: at("2026-07-06T23:00:00Z"),
        clockOutAt: at("2026-07-07T03:30:00Z"),
      },
      { clockInAt: at("2026-07-07T04:00:00Z"), clockOutAt: null },
      {
        clockInAt: at("2026-07-07T05:00:00Z"),
        clockOutAt: at("2026-07-07T05:20:00Z"),
      },
    ];
    const legacy = buildTimesheetLines({
      entries,
      timezone: TZ,
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
    });
    const out = classify(entries, []);
    expect(
      out.lines.map((l) => ({ date: l.date, numberOfUnits: l.numberOfUnits })),
    ).toEqual(legacy.lines);
    expect(out.lines.every((l) => l.earningsRateId === ORD)).toBe(true);
    expect(out.lines.every((l) => l.ruleNames.length === 0)).toBe(true);
    expect(out.totalHours).toBe(legacy.totalHours);
    expect(out.skippedOpen).toBe(legacy.skippedOpen);
    // Every in-period shift appears in the breakdown as one ordinary segment.
    expect(out.breakdown).toHaveLength(4);
    expect(out.breakdown.every((b) => b.segments.length === 1)).toBe(true);
    expect(out.breakdown.every((b) => b.segments[0]!.ruleId === null)).toBe(
      true,
    );
  });

  it("excludes out-of-period days and uses the business-local date", () => {
    const out = classify(
      [
        {
          clockInAt: at("2026-07-06T23:30:00Z"),
          clockOutAt: at("2026-07-07T01:30:00Z"),
        }, // 7 Jul local
        {
          clockInAt: at("2026-07-13T00:00:00Z"),
          clockOutAt: at("2026-07-13T02:00:00Z"),
        }, // 13 Jul → out
      ],
      [],
      { start: "2026-07-07", end: "2026-07-07" },
    );
    expect(out.lines).toEqual([
      {
        date: "2026-07-07",
        earningsRateId: ORD,
        numberOfUnits: 2,
        ruleNames: [],
        earningsRateName: null,
      },
    ]);
  });
});

describe("classifyEntries — day_of_week", () => {
  it("splits an over-midnight shift at local midnight (the moments' own weekday)", () => {
    // Fri 10 Jul 20:00 → Sat 11 Jul 02:00 Sydney. The 2h past midnight ARE
    // Saturday moments; the whole 6h still lands on Friday's line date.
    const saturday = rule(
      1,
      { type: "day_of_week", days: [6] },
      {
        id: "sat",
        name: "Saturday hours",
        earningsRateId: "rate-sat",
        earningsRateName: "Saturday item",
      },
    );
    const out = classify(
      [
        {
          clockInAt: at("2026-07-10T10:00:00Z"),
          clockOutAt: at("2026-07-10T16:00:00Z"),
        },
      ],
      [saturday],
    );
    expect(out.lines).toEqual([
      {
        date: "2026-07-10",
        earningsRateId: ORD,
        numberOfUnits: 4,
        ruleNames: [],
        earningsRateName: null,
      },
      {
        date: "2026-07-10",
        earningsRateId: "rate-sat",
        numberOfUnits: 2,
        ruleNames: ["Saturday hours"],
        earningsRateName: "Saturday item",
      },
    ]);
    expect(out.totalHours).toBe(6);
    const segs = out.breakdown[0]!.segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]!.ruleId).toBeNull();
    expect(segs[0]!.hours).toBe(4);
    expect(segs[1]!.ruleId).toBe("sat");
    expect(segs[1]!.hours).toBe(2);
    // The split instant is local midnight (14:00Z in July).
    expect(segs[1]!.startUtc.toISOString()).toBe("2026-07-10T14:00:00.000Z");
  });

  it("matches a whole shift on the rule's day", () => {
    const saturday = rule(1, { type: "day_of_week", days: [6] });
    const out = classify(
      // Sat 11 Jul 09:00–17:00 Sydney
      [
        {
          clockInAt: at("2026-07-10T23:00:00Z"),
          clockOutAt: at("2026-07-11T07:00:00Z"),
        },
      ],
      [saturday],
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]!.earningsRateId).toBe(saturday.earningsRateId);
    expect(out.lines[0]!.numberOfUnits).toBe(8);
  });
});

describe("classifyEntries — time of day", () => {
  it("time_of_day_after matches wall clock ≥ cutoff, not past midnight", () => {
    // Fri 20:00 → Sat 02:00. "After 22:00" matches 22:00–24:00 ONLY (after
    // midnight the clock reads 00:00–02:00 — the owner adds a before-rule for
    // that if they want it). 20:00–22:00 and 00:00–02:00 stay ordinary.
    const late = rule(
      1,
      { type: "time_of_day_after", time: "22:00" },
      {
        id: "late",
        name: "Late hours",
        earningsRateId: "rate-late",
      },
    );
    const out = classify(
      [
        {
          clockInAt: at("2026-07-10T10:00:00Z"),
          clockOutAt: at("2026-07-10T16:00:00Z"),
        },
      ],
      [late],
    );
    expect(out.lines).toEqual([
      expect.objectContaining({ earningsRateId: ORD, numberOfUnits: 4 }),
      expect.objectContaining({
        earningsRateId: "rate-late",
        numberOfUnits: 2,
      }),
    ]);
    // Segments: 20:00–22:00 ordinary, 22:00–24:00 late, 00:00–02:00 ordinary.
    const segs = out.breakdown[0]!.segments;
    expect(segs.map((s) => [s.ruleId, s.hours])).toEqual([
      [null, 2],
      ["late", 2],
      [null, 2],
    ]);
  });

  it("a shift starting exactly at the cutoff is entirely matched", () => {
    const late = rule(1, { type: "time_of_day_after", time: "22:00" });
    const out = classify(
      // Fri 22:00 → Sat 00:00 Sydney (12:00Z–14:00Z)
      [
        {
          clockInAt: at("2026-07-10T12:00:00Z"),
          clockOutAt: at("2026-07-10T14:00:00Z"),
        },
      ],
      [late],
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]!.earningsRateId).toBe(late.earningsRateId);
    expect(out.lines[0]!.numberOfUnits).toBe(2);
  });

  it("time_of_day_before matches wall clock strictly before the cutoff", () => {
    const early = rule(
      1,
      { type: "time_of_day_before", time: "06:00" },
      {
        id: "early",
        name: "Early hours",
        earningsRateId: "rate-early",
      },
    );
    const out = classify(
      // Mon 6 Jul 05:00–09:00 Sydney (19:00Z Sun –23:00Z Sun)
      [
        {
          clockInAt: at("2026-07-05T19:00:00Z"),
          clockOutAt: at("2026-07-05T23:00:00Z"),
        },
      ],
      [early],
    );
    expect(out.lines).toEqual([
      expect.objectContaining({ earningsRateId: ORD, numberOfUnits: 3 }),
      expect.objectContaining({
        earningsRateId: "rate-early",
        numberOfUnits: 1,
      }),
    ]);
  });
});

describe("classifyEntries — cumulative thresholds", () => {
  it("daily_hours_beyond splits a single long shift at the crossing instant", () => {
    const beyond8 = rule(
      1,
      { type: "daily_hours_beyond", hours: 8 },
      {
        id: "d8",
        name: "Beyond 8",
        earningsRateId: "rate-d8",
      },
    );
    const out = classify(
      // Mon 6 Jul 09:00–19:00 Sydney = 10h
      [
        {
          clockInAt: at("2026-07-05T23:00:00Z"),
          clockOutAt: at("2026-07-06T09:00:00Z"),
        },
      ],
      [beyond8],
    );
    expect(out.lines).toEqual([
      expect.objectContaining({ earningsRateId: ORD, numberOfUnits: 8 }),
      expect.objectContaining({ earningsRateId: "rate-d8", numberOfUnits: 2 }),
    ]);
    // Crossing at 09:00 + 8h = 17:00 local (07:00Z).
    expect(out.breakdown[0]!.segments[1]!.startUtc.toISOString()).toBe(
      "2026-07-06T07:00:00.000Z",
    );
  });

  it("daily_hours_beyond accumulates across a day's multiple shifts", () => {
    const beyond8 = rule(
      1,
      { type: "daily_hours_beyond", hours: 8 },
      {
        earningsRateId: "rate-d8",
      },
    );
    const out = classify(
      [
        // Mon 6 Jul: 06:00–10:00 (4h), then 12:00–18:00 (6h; crosses at 16:00)
        {
          clockInAt: at("2026-07-05T20:00:00Z"),
          clockOutAt: at("2026-07-06T00:00:00Z"),
        },
        {
          clockInAt: at("2026-07-06T02:00:00Z"),
          clockOutAt: at("2026-07-06T08:00:00Z"),
        },
      ],
      [beyond8],
    );
    expect(out.lines).toEqual([
      expect.objectContaining({ earningsRateId: ORD, numberOfUnits: 8 }),
      expect.objectContaining({ earningsRateId: "rate-d8", numberOfUnits: 2 }),
    ]);
    const second = out.breakdown[1]!;
    expect(second.segments.map((s) => [s.ruleId === null, s.hours])).toEqual([
      [true, 4],
      [false, 2],
    ]);
  });

  it("weekly_hours_beyond counts context entries from before the period", () => {
    const beyond20 = rule(
      1,
      { type: "weekly_hours_beyond", hours: 20 },
      {
        earningsRateId: "rate-w20",
      },
    );
    const entries = [
      // Context: Mon 6 + Tue 7 Jul, 10h each (period starts Wed 8 Jul).
      {
        clockInAt: at("2026-07-05T22:00:00Z"),
        clockOutAt: at("2026-07-06T08:00:00Z"),
      },
      {
        clockInAt: at("2026-07-06T22:00:00Z"),
        clockOutAt: at("2026-07-07T08:00:00Z"),
      },
      // In period: Wed 8 Jul 09:00–17:00 — the weekly count is already 20.
      {
        clockInAt: at("2026-07-07T23:00:00Z"),
        clockOutAt: at("2026-07-08T07:00:00Z"),
      },
    ];
    const out = classify(entries, [beyond20], {
      start: "2026-07-08",
      end: "2026-07-14",
    });
    // Context entries emit NO lines; the Wed shift is entirely beyond 20h.
    expect(out.lines).toEqual([
      expect.objectContaining({
        date: "2026-07-08",
        earningsRateId: "rate-w20",
        numberOfUnits: 8,
      }),
    ]);
    expect(out.breakdown).toHaveLength(1); // context shifts aren't shown
    expect(out.totalHours).toBe(8);
  });

  it("weekly_hours_beyond crosses mid-entry and resets on Monday", () => {
    const beyond20 = rule(
      1,
      { type: "weekly_hours_beyond", hours: 20 },
      {
        earningsRateId: "rate-w20",
      },
    );
    const entries = [
      // Week 1 context: Mon 6 Jul, 15h (Sydney 05:00–20:00).
      {
        clockInAt: at("2026-07-05T19:00:00Z"),
        clockOutAt: at("2026-07-06T10:00:00Z"),
      },
      // Wed 8 Jul 09:00–17:00: crosses 20h after 5h → 3h beyond.
      {
        clockInAt: at("2026-07-07T23:00:00Z"),
        clockOutAt: at("2026-07-08T07:00:00Z"),
      },
      // NEXT week, Mon 13 Jul 09:00–17:00: counter reset → all ordinary.
      {
        clockInAt: at("2026-07-12T23:00:00Z"),
        clockOutAt: at("2026-07-13T07:00:00Z"),
      },
    ];
    const out = classify(entries, [beyond20], {
      start: "2026-07-08",
      end: "2026-07-14",
    });
    expect(out.lines).toEqual([
      expect.objectContaining({
        date: "2026-07-08",
        earningsRateId: ORD,
        numberOfUnits: 5,
      }),
      expect.objectContaining({
        date: "2026-07-08",
        earningsRateId: "rate-w20",
        numberOfUnits: 3,
      }),
      expect.objectContaining({
        date: "2026-07-13",
        earningsRateId: ORD,
        numberOfUnits: 8,
      }),
    ]);
  });
});

describe("classifyEntries — precedence", () => {
  it("first match wins by the owner's visible order, deterministically", () => {
    // Both rules match every Saturday moment; only the higher one applies.
    const satFirst = [
      rule(
        1,
        { type: "day_of_week", days: [6] },
        { id: "sat", earningsRateId: "rate-sat" },
      ),
      rule(
        2,
        { type: "time_of_day_after", time: "00:00" },
        { id: "any", earningsRateId: "rate-any" },
      ),
    ];
    const entry = [
      // Sat 11 Jul 09:00–17:00 Sydney
      {
        clockInAt: at("2026-07-10T23:00:00Z"),
        clockOutAt: at("2026-07-11T07:00:00Z"),
      },
    ];
    const a = classify(entry, satFirst);
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0]!.earningsRateId).toBe("rate-sat");

    // Swap the priorities → the other rule wins the same hours.
    const anyFirst = [
      { ...satFirst[0]!, priority: 2 },
      { ...satFirst[1]!, priority: 1 },
    ];
    const b = classify(entry, anyFirst);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0]!.earningsRateId).toBe("rate-any");
  });

  it("a lower-priority rule still applies where the higher one doesn't match", () => {
    const rules = [
      rule(
        1,
        { type: "time_of_day_after", time: "14:00" },
        { id: "arvo", earningsRateId: "rate-arvo" },
      ),
      rule(
        2,
        { type: "day_of_week", days: [6] },
        { id: "sat", earningsRateId: "rate-sat" },
      ),
    ];
    const out = classify(
      // Sat 11 Jul 09:00–17:00: 09:00–14:00 → sat (arvo doesn't match),
      // 14:00–17:00 → arvo (first match wins).
      [
        {
          clockInAt: at("2026-07-10T23:00:00Z"),
          clockOutAt: at("2026-07-11T07:00:00Z"),
        },
      ],
      rules,
    );
    expect(out.lines).toEqual([
      expect.objectContaining({
        earningsRateId: "rate-arvo",
        numberOfUnits: 3,
      }),
      expect.objectContaining({ earningsRateId: "rate-sat", numberOfUnits: 5 }),
    ]);
  });

  it("two rules mapping to the SAME pay item merge into one line", () => {
    const rules = [
      rule(
        1,
        { type: "time_of_day_before", time: "06:00" },
        {
          name: "Early",
          earningsRateId: "rate-x",
          earningsRateName: "Item X",
        },
      ),
      rule(
        2,
        { type: "time_of_day_after", time: "22:00" },
        {
          name: "Late",
          earningsRateId: "rate-x",
          earningsRateName: "Item X",
        },
      ),
    ];
    const out = classify(
      // Mon 6 Jul 05:00–23:30 Sydney (long day: 1h early + 1.5h late match)
      [
        {
          clockInAt: at("2026-07-05T19:00:00Z"),
          clockOutAt: at("2026-07-06T13:30:00Z"),
        },
      ],
      rules,
    );
    expect(out.lines).toEqual([
      expect.objectContaining({ earningsRateId: ORD, numberOfUnits: 16 }),
      expect.objectContaining({
        earningsRateId: "rate-x",
        numberOfUnits: 2.5,
        ruleNames: ["Early", "Late"],
      }),
    ]);
  });
});

describe("classifyEntries — rounding reconciliation", () => {
  it("split lines always sum to the canonical 2dp day total", () => {
    // 20-minute shift split down the middle → raw thirds of an hour that
    // round to 0.17 + 0.17 = 0.34, but the canonical entry total is 0.33.
    const mid = rule(
      1,
      { type: "time_of_day_after", time: "09:10" },
      {
        earningsRateId: "rate-mid",
      },
    );
    const out = classify(
      // Mon 6 Jul 09:00–09:20 Sydney
      [
        {
          clockInAt: at("2026-07-05T23:00:00Z"),
          clockOutAt: at("2026-07-05T23:20:00Z"),
        },
      ],
      [mid],
    );
    const sum = out.lines.reduce((s, l) => s + l.numberOfUnits, 0);
    expect(Math.round(sum * 100) / 100).toBe(0.33);
    expect(out.lines.map((l) => l.numberOfUnits)).toEqual([0.16, 0.17]);
    expect(out.totalHours).toBe(0.33);
  });

  it("a day's split lines reconcile to the same total buildTimesheetLines gives", () => {
    const entries = [
      {
        clockInAt: at("2026-07-05T23:07:00Z"),
        clockOutAt: at("2026-07-06T02:11:00Z"),
      },
      {
        clockInAt: at("2026-07-06T03:03:00Z"),
        clockOutAt: at("2026-07-06T08:49:00Z"),
      },
    ];
    const legacy = buildTimesheetLines({
      entries,
      timezone: TZ,
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
    });
    const out = classify(entries, [
      rule(
        1,
        { type: "daily_hours_beyond", hours: 5 },
        { earningsRateId: "rate-d5" },
      ),
    ]);
    const byDate = new Map<string, number>();
    for (const l of out.lines) {
      byDate.set(
        l.date,
        Math.round(((byDate.get(l.date) ?? 0) + l.numberOfUnits) * 100) / 100,
      );
    }
    expect([...byDate.entries()]).toEqual(
      legacy.lines.map((l) => [l.date, l.numberOfUnits]),
    );
    expect(out.totalHours).toBe(legacy.totalHours);
  });
});

describe("classifyEntries — edge cases", () => {
  it("counts open entries as skipped only inside the period", () => {
    const out = classify(
      [
        { clockInAt: at("2026-07-06T00:00:00Z"), clockOutAt: null }, // in period
        { clockInAt: at("2026-06-29T00:00:00Z"), clockOutAt: null }, // context
      ],
      [],
      { start: "2026-07-06", end: "2026-07-12" },
    );
    expect(out.skippedOpen).toBe(1);
    expect(out.lines).toEqual([]);
  });

  it("ignores zero/negative-duration entries", () => {
    const out = classify(
      [
        {
          clockInAt: at("2026-07-06T02:00:00Z"),
          clockOutAt: at("2026-07-06T02:00:00Z"),
        },
        {
          clockInAt: at("2026-07-06T03:00:00Z"),
          clockOutAt: at("2026-07-06T02:30:00Z"),
        },
      ],
      [rule(1, { type: "day_of_week", days: [1] })],
    );
    expect(out.lines).toEqual([]);
    expect(out.breakdown).toEqual([]);
    expect(out.totalHours).toBe(0);
  });

  it("inactive/unknown rules never appear (toActivePayRules is the only door in)", () => {
    // classifyEntries trusts its input list; the flow test covers the DB side.
    const out = classify(
      [
        {
          clockInAt: at("2026-07-06T00:00:00Z"),
          clockOutAt: at("2026-07-06T04:00:00Z"),
        },
      ],
      [],
    );
    expect(out.lines[0]!.ruleNames).toEqual([]);
  });
});
