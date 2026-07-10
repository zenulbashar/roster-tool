import { z } from "zod";
import {
  businessDateOf,
  eachDate,
  formatTimeOnly,
  isoWeekday,
  tzOffsetMs,
  zonedDateTimeToUtc,
} from "@/lib/time";
import { hoursWorked } from "@/lib/timesheet-export";
import type { PushEntry } from "./timesheet-lines";

/**
 * OWNER-AUTHORED pay-classification rules — the pure, deterministic evaluator.
 *
 * A rule is a mechanical mapping the owner writes: a condition over worked time
 * (day-of-week, time-of-day, cumulative hours in a day/week) → ONE of the
 * owner's OWN Xero pay items. `classifyEntries` splits each shift's hours into
 * sub-blocks at every point where a condition's answer could change, matches
 * each sub-block against the owner's ordered rule list (FIRST MATCH WINS —
 * precedence is the owner-visible list order, never a silent pick), and
 * aggregates the result into per-day, per-pay-item timesheet lines.
 *
 * THE BOUNDARY: Roster ships with ZERO built-in rules and stores NO dollar
 * figure and NO multiplier — this module moves hours between the owner's pay
 * items and nothing else. All pay math lives in Xero. Evaluation is
 * server-side over stored clock data; nothing here reads client input.
 *
 * Semantics (all mechanical, all shown to the owner in the preview):
 * - Hours land on the line for the business-local date the shift STARTED
 *   (identical bucketing to `buildTimesheetLines`, the CSV export and report).
 * - Conditions look at each worked MOMENT's own local wall clock: in a Friday
 *   20:00 → Saturday 02:00 shift, the two hours past midnight are "Saturday"
 *   hours for a day-of-week rule, and "after 10 pm" matches only 22:00–24:00
 *   (after midnight the clock reads 00:00–02:00).
 * - `daily_hours_beyond` accumulates over the shift's bucket date;
 *   `weekly_hours_beyond` over the business-local Monday-start week. Entries
 *   BEFORE the pay period may be supplied as context: they advance the
 *   cumulative counters but never produce lines.
 * - Per bucket date, the canonical day total is computed exactly as the shipped
 *   push does (2dp per entry, summed). Split lines are rounded to 2dp and any
 *   ±0.01-scale remainder is absorbed into the largest line, so the split
 *   ALWAYS sums to the same day total the CSV/report/M27 push produce. With
 *   zero rules the output is line-for-line identical to `buildTimesheetLines`.
 */

export const PAY_RULE_CONDITION_TYPES = [
  "day_of_week",
  "time_of_day_after",
  "time_of_day_before",
  "daily_hours_beyond",
  "weekly_hours_beyond",
] as const;

export type PayRuleConditionType = (typeof PAY_RULE_CONDITION_TYPES)[number];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Per-type zod schema for the stored `condition_config` (type lives in the
 * enum column, not the json). Shared by the server actions and the row parser. */
export const payRuleConditionConfigSchemas = {
  day_of_week: z.object({
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  }),
  time_of_day_after: z.object({ time: z.string().regex(TIME_RE) }),
  time_of_day_before: z.object({ time: z.string().regex(TIME_RE) }),
  daily_hours_beyond: z.object({ hours: z.number().gt(0).lte(24) }),
  weekly_hours_beyond: z.object({ hours: z.number().gt(0).lte(168) }),
} as const;

export type PayRuleCondition =
  | { type: "day_of_week"; days: number[] } // ISO 1–7 (Mon–Sun)
  | { type: "time_of_day_after"; time: string } // "HH:MM" local wall clock
  | { type: "time_of_day_before"; time: string }
  | { type: "daily_hours_beyond"; hours: number }
  | { type: "weekly_hours_beyond"; hours: number };

/** Parse a stored (type, config) pair; null when the config doesn't validate. */
export function parsePayRuleCondition(
  type: PayRuleConditionType,
  config: unknown,
): PayRuleCondition | null {
  const parsed = payRuleConditionConfigSchemas[type]?.safeParse(config);
  if (!parsed?.success) return null;
  return { type, ...parsed.data } as PayRuleCondition;
}

/** A rule ready for evaluation (parsed condition, active only). */
export type ActivePayRule = {
  id: string;
  name: string;
  priority: number; // lower = higher precedence (the owner's list order)
  condition: PayRuleCondition;
  earningsRateId: string;
  earningsRateName: string;
};

/** The shape `listPayRules` rows arrive in (structural — no drizzle import). */
export type PayRuleRowLike = {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  conditionType: PayRuleConditionType;
  conditionConfig: unknown;
  earningsRateId: string;
  earningsRateName: string;
};

/**
 * DB rows → evaluable rules: keep active rows whose config parses, in
 * precedence order. (Rows are only written through zod-validated actions, so a
 * non-parsing config means tampering — such a rule is silently inert here and
 * visibly flagged on the rules page rather than guessed at.)
 */
export function toActivePayRules(rows: PayRuleRowLike[]): ActivePayRule[] {
  const out: ActivePayRule[] = [];
  for (const r of rows) {
    if (!r.isActive) continue;
    const condition = parsePayRuleCondition(r.conditionType, r.conditionConfig);
    if (!condition) continue;
    out.push({
      id: r.id,
      name: r.name,
      priority: r.priority,
      condition,
      earningsRateId: r.earningsRateId,
      earningsRateName: r.earningsRateName,
    });
  }
  return out.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Owner-facing description of a condition, e.g. "Hours on Saturday & Sunday",
 * "Hours after 10 pm", "Hours beyond 8 in a day". Pure; unit-tested. */
export function describePayRuleCondition(condition: PayRuleCondition): string {
  switch (condition.type) {
    case "day_of_week": {
      const names = [...condition.days]
        .sort((a, b) => a - b)
        .map((d) => DAY_NAMES[d - 1] ?? `Day ${d}`);
      const list =
        names.length <= 1
          ? (names[0] ?? "")
          : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
      return `Hours on ${list}`;
    }
    case "time_of_day_after":
      return `Hours after ${formatTimeOnly(condition.time)}`;
    case "time_of_day_before":
      return `Hours before ${formatTimeOnly(condition.time)}`;
    case "daily_hours_beyond":
      return `Hours beyond ${condition.hours} in a day`;
    case "weekly_hours_beyond":
      return `Hours beyond ${condition.hours} in a week (Mon–Sun)`;
  }
}

/** The Monday ("YYYY-MM-DD") of the ISO week containing `date`. */
export function mondayOfWeek(date: string): string {
  const wd = isoWeekday(date);
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! - (wd - 1)));
  return dt.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

export type ClassifiedLine = {
  date: string;
  earningsRateId: string;
  /** 2dp hours; a date's lines always sum to the canonical day total. */
  numberOfUnits: number;
  /** Names of the owner's rules that routed hours here; empty = ordinary. */
  ruleNames: string[];
  /** Snapshot pay-item name from the rule; null = the ordinary rate. */
  earningsRateName: string | null;
};

export type ShiftSegment = {
  startUtc: Date;
  endUtc: Date;
  /** 2dp, display only (per-day reconciliation happens on the lines). */
  hours: number;
  ruleId: string | null; // null = no rule matched → ordinary rate
  ruleName: string | null;
  earningsRateId: string;
  earningsRateName: string | null;
};

/** One shift's classification — the pre-push preview's human checkpoint. */
export type ShiftBreakdown = {
  date: string; // bucket (clock-in local) date
  clockInAt: Date;
  clockOutAt: Date;
  hours: number; // canonical 2dp entry hours
  segments: ShiftSegment[];
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const EPS = 1e-9;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function timeToMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Local wall-clock minute-of-day (fractional) of an instant in a timezone. */
function localMinuteOfDay(instant: Date, timeZone: string): number {
  const local = instant.getTime() + tzOffsetMs(instant, timeZone);
  return (((local % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
}

/**
 * Split + classify one employee's entries into per-day, per-pay-item lines.
 *
 * `entries` may include entries from BEFORE `periodStart` (back to the Monday
 * of its week) purely as cumulation context — they advance the daily/weekly
 * counters but emit no lines and no breakdown. `rules` must be the ACTIVE,
 * parsed rules (see `toActivePayRules`); with `rules: []` the result is
 * identical to `buildTimesheetLines` under the ordinary rate.
 */
export function classifyEntries(input: {
  entries: PushEntry[];
  rules: ActivePayRule[];
  ordinaryEarningsRateId: string;
  timezone: string;
  /** Inclusive Xero pay-period bounds (YYYY-MM-DD), FROM the Xero calendar. */
  periodStart: string;
  periodEnd: string;
}): {
  lines: ClassifiedLine[];
  totalHours: number;
  skippedOpen: number;
  breakdown: ShiftBreakdown[];
} {
  const { timezone: tz, periodStart, periodEnd, ordinaryEarningsRateId } = input;
  const rules = [...input.rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  const sorted = [...input.entries].sort(
    (a, b) => a.clockInAt.getTime() - b.clockInAt.getTime(),
  );

  const dayCum = new Map<string, number>(); // exact hours per bucket date
  const weekCum = new Map<string, number>(); // exact hours per Monday key
  const dayCanonical = new Map<string, number>(); // 2dp day totals (in period)
  type Group = {
    raw: number;
    ruleNames: Set<string>;
    rateName: string | null;
    ordinal: number; // -1 = ordinary; else best (lowest) rule priority
  };
  const groups = new Map<string, Map<string, Group>>(); // date → rateId → group
  const breakdown: ShiftBreakdown[] = [];
  let skippedOpen = 0;

  for (const entry of sorted) {
    const bucketDate = businessDateOf(entry.clockInAt, tz);
    const inPeriod = bucketDate >= periodStart && bucketDate <= periodEnd;
    const hours2 = hoursWorked(entry.clockInAt, entry.clockOutAt);
    if (hours2 === null) {
      if (inPeriod) skippedOpen++; // still clocked in — never guessed
      continue;
    }
    if (hours2 <= 0) continue;

    const inMs = entry.clockInAt.getTime();
    const outMs = entry.clockOutAt!.getTime();
    const exactHours = (outMs - inMs) / HOUR_MS;
    const weekKey = mondayOfWeek(bucketDate);
    const dayStart = dayCum.get(bucketDate) ?? 0;
    const weekStart = weekCum.get(weekKey) ?? 0;

    // -- breakpoints: every instant where some condition's answer could flip.
    const points = new Set<number>();
    const localDates = eachDate(
      bucketDate,
      businessDateOf(entry.clockOutAt!, tz),
    );
    for (const d of localDates.slice(1)) {
      const t = zonedDateTimeToUtc(d, "00:00", tz).getTime();
      if (t > inMs && t < outMs) points.add(t); // local midnight(s)
    }
    for (const r of rules) {
      const c = r.condition;
      if (c.type === "time_of_day_after" || c.type === "time_of_day_before") {
        for (const d of localDates) {
          const t = zonedDateTimeToUtc(d, c.time, tz).getTime();
          if (t > inMs && t < outMs) points.add(t);
        }
      } else if (c.type === "daily_hours_beyond") {
        if (dayStart < c.hours - EPS && dayStart + exactHours > c.hours + EPS) {
          points.add(inMs + (c.hours - dayStart) * HOUR_MS);
        }
      } else if (c.type === "weekly_hours_beyond") {
        if (
          weekStart < c.hours - EPS &&
          weekStart + exactHours > c.hours + EPS
        ) {
          points.add(inMs + (c.hours - weekStart) * HOUR_MS);
        }
      }
    }
    const cuts = [inMs, ...[...points].sort((a, b) => a - b), outMs];

    // -- match each atomic sub-block; first rule in precedence order wins.
    type Seg = { s: number; e: number; rule: ActivePayRule | null };
    const segs: Seg[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const s = cuts[i]!;
      const e = cuts[i + 1]!;
      if (e - s <= 0) continue;
      const mid = new Date(s + (e - s) / 2);
      const weekday = isoWeekday(businessDateOf(mid, tz));
      const minuteOfDay = localMinuteOfDay(mid, tz);
      const dayBefore = dayStart + (s - inMs) / HOUR_MS;
      const weekBefore = weekStart + (s - inMs) / HOUR_MS;
      const winner =
        rules.find((r) => {
          const c = r.condition;
          switch (c.type) {
            case "day_of_week":
              return c.days.includes(weekday);
            case "time_of_day_after":
              return minuteOfDay >= timeToMinutes(c.time) - EPS;
            case "time_of_day_before":
              return minuteOfDay < timeToMinutes(c.time) - EPS;
            case "daily_hours_beyond":
              return dayBefore >= c.hours - EPS;
            case "weekly_hours_beyond":
              return weekBefore >= c.hours - EPS;
          }
        }) ?? null;
      const prev = segs[segs.length - 1];
      if (prev && (prev.rule?.id ?? null) === (winner?.id ?? null)) {
        prev.e = e; // merge consecutive sub-blocks with the same outcome
      } else {
        segs.push({ s, e, rule: winner });
      }
    }

    dayCum.set(bucketDate, dayStart + exactHours);
    weekCum.set(weekKey, weekStart + exactHours);
    if (!inPeriod) continue; // context entry: cumulation only, no output

    dayCanonical.set(
      bucketDate,
      round2((dayCanonical.get(bucketDate) ?? 0) + hours2),
    );
    let byRate = groups.get(bucketDate);
    if (!byRate) {
      byRate = new Map();
      groups.set(bucketDate, byRate);
    }
    const segments: ShiftSegment[] = [];
    for (const sg of segs) {
      const rateId = sg.rule?.earningsRateId ?? ordinaryEarningsRateId;
      const rateName = sg.rule?.earningsRateName ?? null;
      let g = byRate.get(rateId);
      if (!g) {
        g = { raw: 0, ruleNames: new Set(), rateName: null, ordinal: -1 };
        g.ordinal = sg.rule ? sg.rule.priority : -1;
        byRate.set(rateId, g);
      }
      g.raw += (sg.e - sg.s) / HOUR_MS;
      if (sg.rule) {
        g.ruleNames.add(sg.rule.name);
        if (g.rateName === null) g.rateName = rateName;
        if (g.ordinal !== -1) g.ordinal = Math.min(g.ordinal, sg.rule.priority);
      } else {
        g.ordinal = -1; // any ordinary hours pin the group to sort first
      }
      segments.push({
        startUtc: new Date(sg.s),
        endUtc: new Date(sg.e),
        hours: round2((sg.e - sg.s) / HOUR_MS),
        ruleId: sg.rule?.id ?? null,
        ruleName: sg.rule?.name ?? null,
        earningsRateId: rateId,
        earningsRateName: rateName,
      });
    }
    breakdown.push({
      date: bucketDate,
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt!,
      hours: hours2,
      segments,
    });
  }

  // -- per-day rounding reconciliation: split lines must sum to the SAME 2dp
  //    day total the unsplit path (CSV/report/M27 push) produces.
  const lines: ClassifiedLine[] = [];
  const dates = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const date of dates) {
    const canonical = dayCanonical.get(date) ?? 0;
    const rows = [...groups.get(date)!.entries()]
      .map(([rateId, g]) => ({ rateId, ...g, units: round2(g.raw) }))
      .sort(
        (a, b) => a.ordinal - b.ordinal || a.rateId.localeCompare(b.rateId),
      );
    const diff = round2(canonical - rows.reduce((s, r) => s + r.units, 0));
    if (Math.abs(diff) >= 0.005) {
      let target = rows[0]!;
      for (const r of rows) if (r.raw > target.raw + EPS) target = r;
      target.units = round2(target.units + diff);
    }
    for (const r of rows) {
      if (r.units <= 0) continue;
      lines.push({
        date,
        earningsRateId: r.rateId,
        numberOfUnits: r.units,
        ruleNames: [...r.ruleNames],
        earningsRateName: r.rateName,
      });
    }
  }
  const totalHours = round2(
    [...dayCanonical.values()].reduce((s, v) => s + v, 0),
  );
  return { lines, totalHours, skippedOpen, breakdown };
}
