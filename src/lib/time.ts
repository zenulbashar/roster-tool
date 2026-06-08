/**
 * Time helpers. Rule for the whole app: store everything in UTC, format for
 * display in the business timezone using these functions. UI uses DD/MM dates.
 */

export const DEFAULT_TIMEZONE = "Australia/Sydney";

/** A calendar date with no time component, stored as "YYYY-MM-DD". */
export type DateOnly = string;

/** A wall-clock time with no date, stored as "HH:MM" (24h). */
export type TimeOnly = string;

/**
 * Format an instant as DD/MM/YYYY in the given timezone.
 */
export function formatDate(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Format an instant as e.g. "Mon 09/06/2025, 2:30 pm" in the given timezone.
 */
export function formatDateTime(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Format a "YYYY-MM-DD" calendar date as e.g. "Mon 09/06". Timezone-free: a
 * roster shift on a date is the same date for everyone in the business.
 */
export function formatDateOnly(date: DateOnly): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  // Construct at UTC noon to avoid any DST edge shifting the weekday.
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
  }).format(d);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${weekday} ${dd}/${mm}`;
}

/**
 * Format a "HH:MM" 24h time as a friendly "9:00 am" / "5:30 pm".
 */
export function formatTimeOnly(time: TimeOnly): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const period = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0
    ? `${hour12} ${period}`
    : `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Inclusive list of "YYYY-MM-DD" dates from start to end. Used to expand a
 * roster period into individual days.
 */
export function eachDate(start: DateOnly, end: DateOnly): DateOnly[] {
  const result: DateOnly[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return result;
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));
  while (cur <= last) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

/**
 * Offset in milliseconds (local - UTC) for a given instant in a timezone.
 * Positive for zones ahead of UTC (e.g. Australia/Sydney).
 */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * Convert a wall-clock date+time in a business's timezone to the corresponding
 * UTC instant. e.g. ("2025-06-09", "17:00", "Australia/Sydney") -> 07:00Z.
 * Stores deadlines correctly regardless of where the server runs.
 */
export function zonedDateTimeToUtc(
  date: DateOnly,
  time: TimeOnly,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const naiveUtc = new Date(
    `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`,
  );
  const offset = tzOffsetMs(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offset);
}

/**
 * The business-local calendar date ("YYYY-MM-DD") for a UTC instant. e.g. an
 * 07:30Z clock-in is "today" in Sydney but may be a different date than the UTC
 * date. Used to link a clock-in to the rostered shift on that local day.
 */
export function businessDateOf(
  instant: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): DateOnly {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** ISO weekday for a "YYYY-MM-DD" date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: DateOnly): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}
