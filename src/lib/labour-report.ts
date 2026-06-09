/**
 * Pure hours & labour-cost reporting. No DB, no clock reads except the dates you
 * pass in — so every branch is unit-testable. This is READ-ONLY reporting over
 * data the app already collects (timesheets + the rate the owner typed).
 *
 * CRITICAL FRAMING: every cost figure here is an ESTIMATE — worked hours × the
 * entered hourly rate. It is NOT a payroll calculation: no penalty rates,
 * overtime, loading, super or award interpretation. See LABOUR_COST_DISCLAIMER.
 *
 * Decisions (kept consistent with the CSV export in `timesheet-export.ts`):
 *  - COST is from APPROVED, closed entries only (the owner's payroll sign-off).
 *  - HOURS are split into APPROVED (the cost basis) and PENDING (unapproved,
 *    NOT costed) so a live current week isn't misleadingly empty.
 *  - OPEN entries (no clock-out) have no defined worked duration → excluded
 *    from hours and cost, and counted separately so the UI can flag them.
 *  - Per-entry hours are rounded to 2dp before summing (matching the export), so
 *    the report totals agree with the CSV.
 *  - A staff member with no rate set contributes HOURS but a NULL cost (never
 *    treated as $0) and is flagged.
 *  - Weeks are ISO weeks, Monday-start, bucketed by the BUSINESS-LOCAL date of
 *    each clock-in.
 */
import { businessDateOf, isoWeekday, type DateOnly } from "@/lib/time";

/** Reused estimate disclaimer, mirroring the CSV export's wording. */
export const LABOUR_COST_DISCLAIMER =
  "Estimated cost is worked hours x the entered rate. This is NOT a payroll calculation — penalty rates, overtime, super and final pay are the owner's/payroll system's responsibility.";

export type RateType = "flat" | "award";

/** One timesheet entry as it feeds the report (business-scoped upstream). */
export type ReportEntry = {
  staffMemberId: string;
  staffName: string;
  payRateCents: number | null;
  rateType: RateType;
  rateLabel: string | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  approved: boolean;
};

export type WindowPreset = "current" | "last4" | "custom";

/** A resolved reporting window: [startDate, endDate) date-only + spanned weeks. */
export type ReportWindow = {
  preset: WindowPreset;
  /** Inclusive first calendar day (YYYY-MM-DD), business-local. */
  startDate: DateOnly;
  /** EXCLUSIVE day after the last day (YYYY-MM-DD), business-local. */
  endDate: DateOnly;
  /** Monday (YYYY-MM-DD) of every ISO week the window touches, ascending. */
  weeks: DateOnly[];
};

export type StaffLabour = {
  staffMemberId: string;
  staffName: string;
  payRateCents: number | null;
  rateType: RateType;
  rateLabel: string | null;
  hasRate: boolean;
  /** Worked hours from approved, closed entries (the cost basis). */
  approvedHours: number;
  /** Worked hours from unapproved, closed entries (NOT costed). */
  pendingHours: number;
  /** Estimated cost in cents from approved hours; NULL when no rate is set. */
  estCostCents: number | null;
  /** Count of approved, closed entries. */
  approvedEntryCount: number;
  /** Mean approved hours per approved entry (0 when none). */
  avgHoursPerEntry: number;
};

export type WeekLabour = {
  weekStart: DateOnly;
  approvedHours: number;
  pendingHours: number;
  estCostCents: number;
  approvedEntryCount: number;
};

export type LabourTotals = {
  approvedHours: number;
  pendingHours: number;
  estCostCents: number;
  approvedEntryCount: number;
  /** Staff who worked in the window but have no rate set. */
  staffWithoutRateCount: number;
  /** Open (still clocked-in) entries in the window — excluded from hours. */
  openEntryCount: number;
};

export type LabourReport = {
  perStaff: StaffLabour[];
  totals: LabourTotals;
  weekly: WeekLabour[];
};

/** Add `n` whole days to a YYYY-MM-DD date (calendar math, tz-independent). */
export function addDays(dateStr: DateOnly, n: number): DateOnly {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD) of the ISO week containing `dateStr`. */
export function mondayOf(dateStr: DateOnly): DateOnly {
  return addDays(dateStr, -(isoWeekday(dateStr) - 1));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Max custom span (days) — a guard against absurd ranges, not a feature limit. */
const MAX_CUSTOM_SPAN_DAYS = 366;

/** Whole days from `start` (inclusive) to `end` (exclusive). */
function daysBetween(start: DateOnly, end: DateOnly): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const a = Date.UTC(sy!, sm! - 1, sd!);
  const b = Date.UTC(ey!, em! - 1, ed!);
  return Math.round((b - a) / 86_400_000);
}

/** List of week-Monday dates covering [startDate, endDate) (ascending). */
function weeksSpanning(startDate: DateOnly, endDate: DateOnly): DateOnly[] {
  const weeks: DateOnly[] = [];
  let cursor = mondayOf(startDate);
  // endDate is exclusive; include any week whose Monday is before endDate.
  while (cursor < endDate) {
    weeks.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/**
 * Resolve an owner-selected window into concrete business-local dates.
 *  - `current`: the ISO week (Mon–Sun) containing `today`.
 *  - `last4`: the current week and the three before it (4 weeks).
 *  - `custom`: [from, to] inclusive (endDate is to + 1 day). Falls back to the
 *    current week when from/to are missing, malformed, reversed, or too wide.
 * `today` is the BUSINESS-LOCAL date (callers pass businessDateOf(now, tz)).
 */
export function resolveWindow(
  preset: WindowPreset,
  opts: { today: DateOnly; from?: string | null; to?: string | null },
): ReportWindow {
  const thisMonday = mondayOf(opts.today);

  if (preset === "custom") {
    const { from, to } = opts;
    const valid =
      from != null &&
      to != null &&
      DATE_RE.test(from) &&
      DATE_RE.test(to) &&
      from <= to &&
      daysBetween(from, to) <= MAX_CUSTOM_SPAN_DAYS;
    if (valid) {
      const startDate = from!;
      const endDate = addDays(to!, 1); // make `to` inclusive
      return {
        preset: "custom",
        startDate,
        endDate,
        weeks: weeksSpanning(startDate, endDate),
      };
    }
    // Invalid custom input → safe default of the current week.
    const endDate = addDays(thisMonday, 7);
    return {
      preset: "current",
      startDate: thisMonday,
      endDate,
      weeks: weeksSpanning(thisMonday, endDate),
    };
  }

  if (preset === "last4") {
    const startDate = addDays(thisMonday, -21);
    const endDate = addDays(thisMonday, 7);
    return {
      preset: "last4",
      startDate,
      endDate,
      weeks: weeksSpanning(startDate, endDate),
    };
  }

  // current week
  const endDate = addDays(thisMonday, 7);
  return {
    preset: "current",
    startDate: thisMonday,
    endDate,
    weeks: weeksSpanning(thisMonday, endDate),
  };
}

/** Worked hours (2dp) for a closed entry, or null while still open. */
export function entryHours(
  clockInAt: Date,
  clockOutAt: Date | null,
): number | null {
  if (!clockOutAt) return null;
  const ms = clockOutAt.getTime() - clockInAt.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Round a float to 2dp, killing binary float fuzz on accumulated sums. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type StaffAccum = {
  meta: Omit<
    StaffLabour,
    | "hasRate"
    | "approvedHours"
    | "pendingHours"
    | "estCostCents"
    | "approvedEntryCount"
    | "avgHoursPerEntry"
  >;
  approvedHours: number;
  pendingHours: number;
  estCostCents: number;
  approvedEntryCount: number;
};

/**
 * Aggregate timesheet entries into per-staff, per-week and total hours/cost.
 * `tz` buckets each clock-in into its business-local ISO week. Only entries
 * already filtered to the window (and business) should be passed in; `window`
 * supplies the full week list so zero-entry weeks still appear for trends.
 */
export function aggregateLabour(
  entries: ReportEntry[],
  window: ReportWindow,
  tz: string,
): LabourReport {
  const staff = new Map<string, StaffAccum>();
  const weeks = new Map<string, WeekLabour>();
  for (const w of window.weeks) {
    weeks.set(w, {
      weekStart: w,
      approvedHours: 0,
      pendingHours: 0,
      estCostCents: 0,
      approvedEntryCount: 0,
    });
  }

  let openEntryCount = 0;

  for (const e of entries) {
    const hours = entryHours(e.clockInAt, e.clockOutAt);
    if (hours === null) {
      openEntryCount += 1;
      continue; // open entry — no defined duration, excluded from hours/cost
    }

    const s =
      staff.get(e.staffMemberId) ??
      ({
        meta: {
          staffMemberId: e.staffMemberId,
          staffName: e.staffName,
          payRateCents: e.payRateCents,
          rateType: e.rateType,
          rateLabel: e.rateLabel,
        },
        approvedHours: 0,
        pendingHours: 0,
        estCostCents: 0,
        approvedEntryCount: 0,
      } satisfies StaffAccum);

    const weekKey = mondayOf(businessDateOf(e.clockInAt, tz));
    const wk = weeks.get(weekKey);
    const costCents =
      e.payRateCents != null ? Math.round(hours * e.payRateCents) : 0;

    if (e.approved) {
      s.approvedHours = round2(s.approvedHours + hours);
      s.approvedEntryCount += 1;
      if (e.payRateCents != null) s.estCostCents += costCents;
      if (wk) {
        wk.approvedHours = round2(wk.approvedHours + hours);
        wk.approvedEntryCount += 1;
        if (e.payRateCents != null) wk.estCostCents += costCents;
      }
    } else {
      s.pendingHours = round2(s.pendingHours + hours);
      if (wk) wk.pendingHours = round2(wk.pendingHours + hours);
    }

    staff.set(e.staffMemberId, s);
  }

  const perStaff: StaffLabour[] = [...staff.values()]
    .map((s) => {
      const hasRate = s.meta.payRateCents != null;
      return {
        ...s.meta,
        hasRate,
        approvedHours: s.approvedHours,
        pendingHours: s.pendingHours,
        estCostCents: hasRate ? s.estCostCents : null,
        approvedEntryCount: s.approvedEntryCount,
        avgHoursPerEntry:
          s.approvedEntryCount > 0
            ? round2(s.approvedHours / s.approvedEntryCount)
            : 0,
      } satisfies StaffLabour;
    })
    .sort((a, b) => a.staffName.localeCompare(b.staffName));

  const totals: LabourTotals = {
    approvedHours: round2(perStaff.reduce((t, s) => t + s.approvedHours, 0)),
    pendingHours: round2(perStaff.reduce((t, s) => t + s.pendingHours, 0)),
    estCostCents: perStaff.reduce((t, s) => t + (s.estCostCents ?? 0), 0),
    approvedEntryCount: perStaff.reduce((t, s) => t + s.approvedEntryCount, 0),
    staffWithoutRateCount: perStaff.filter(
      (s) => !s.hasRate && (s.approvedHours > 0 || s.pendingHours > 0),
    ).length,
    openEntryCount,
  };

  return { perStaff, totals, weekly: [...weeks.values()] };
}

/** Format integer cents as AUD, e.g. 123456 → "$1,234.56". */
export function formatAudCents(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}
