/**
 * CSV export of APPROVED hours for the owner/bookkeeper to import elsewhere.
 *
 * This is deliberately generic and pure (no DB). It records hours and the rate
 * the owner typed and shows an ESTIMATE of hours × rate. It is NOT a payroll
 * calculation: penalty rates, overtime, loading, super and final pay are the
 * owner's / payroll system's responsibility. Times are formatted in the
 * business timezone; dates as DD/MM/YYYY, matching the app.
 */
import { formatDate } from "@/lib/time";

export type ExportRow = {
  staffName: string;
  staffEmail: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  /** Unpaid break minutes deducted from the total-hours column. */
  breakMinutes: number;
  withinGeofence: boolean | null;
  payRateCents: number | null;
  rateType: "flat" | "award";
  rateLabel: string | null;
};

/** Prominent disclaimer reused in the UI and embedded in the CSV. */
export const APPROVED_HOURS_DISCLAIMER =
  "Estimated amounts are hours x the entered rate. This is NOT a payroll calculation — penalty rates, overtime, super and final pay are the owner's/payroll system's responsibility.";

const HEADER = [
  "Staff name",
  "Staff email",
  "Date",
  "Clock in",
  "Clock out",
  "Break (min)",
  "Total hours",
  "Rate type",
  "Hourly rate",
  "Estimated amount",
  "Location verified",
] as const;

/** Escape a single CSV cell (RFC 4180): quote if it contains , " or newline. */
export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Neutralise spreadsheet FORMULA INJECTION. A cell whose value begins with one
 * of `= + - @`, a tab, or a carriage return can be executed as a formula by
 * Excel/Google Sheets on open. We prefix such a value with a single apostrophe
 * so the spreadsheet treats it as literal text. Treat EVERY value as hostile —
 * exported data includes staff names, imported item names and anonymous public
 * form answers, none reliably owner-typed. Legit hours/rates/ratings never
 * start with a dangerous char, so this only changes cells that need it.
 */
export function sanitizeCsvValue(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * One CSV field: neutralise injection on the RAW value FIRST, then RFC-4180
 * escape. Order matters — the guard apostrophe must be inside the quoting.
 */
export function csvField(value: string): string {
  return csvCell(sanitizeCsvValue(value));
}

const csvRow = (cells: string[]): string => cells.map(csvField).join(",");

/** "HH:MM" (24h) for an instant in the given timezone. */
function timeInTz(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/**
 * NET worked hours (2dp) for a closed entry, or null while still open.
 * `breakMinutes` is an unpaid break subtracted from the gross clock in→out span,
 * clamped at zero (a break ≥ the span yields 0, never negative). With the default
 * `breakMinutes = 0` this is the original gross-hours behaviour.
 */
export function hoursWorked(
  clockInAt: Date,
  clockOutAt: Date | null,
  breakMinutes = 0,
): number | null {
  if (!clockOutAt) return null;
  const grossMs = clockOutAt.getTime() - clockInAt.getTime();
  const ms = grossMs - Math.max(0, breakMinutes) * 60_000;
  if (ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/**
 * Build the CSV text for a set of already-filtered (approved, in-range,
 * business-scoped) entries. Leading title + disclaimer lines, then the header
 * row, then one row per entry.
 */
export function buildApprovedHoursCsv(
  rows: ExportRow[],
  opts: { timezone: string; businessName: string },
): string {
  const lines: string[] = [];
  lines.push(csvRow([`${opts.businessName} — Approved hours`]));
  lines.push(csvRow([APPROVED_HOURS_DISCLAIMER]));
  lines.push("");
  lines.push(csvRow([...HEADER]));

  for (const r of rows) {
    const hours = hoursWorked(r.clockInAt, r.clockOutAt, r.breakMinutes);
    const rate = r.payRateCents != null ? r.payRateCents / 100 : null;
    const estimate =
      hours != null && rate != null ? (hours * rate).toFixed(2) : "";
    const rateTypeCell = r.rateLabel
      ? `${r.rateType} (${r.rateLabel})`
      : r.rateType;

    lines.push(
      csvRow([
        r.staffName,
        r.staffEmail,
        formatDate(r.clockInAt, opts.timezone),
        timeInTz(r.clockInAt, opts.timezone),
        r.clockOutAt ? timeInTz(r.clockOutAt, opts.timezone) : "",
        String(r.breakMinutes),
        hours != null ? hours.toFixed(2) : "",
        rateTypeCell,
        rate != null ? rate.toFixed(2) : "",
        estimate,
        r.withinGeofence === true ? "Yes" : "",
      ]),
    );
  }

  return lines.join("\r\n");
}
