import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ownerRepo } from "@/lib/auth/context";
import {
  DEFAULT_TIMEZONE,
  businessDateOf,
  formatDateOnly,
  formatTimeOnly,
  isoWeekday,
  zonedDateTimeToUtc,
} from "@/lib/time";
import { entryDurationMs } from "@/lib/clock";
import { breakMinutesSchema } from "@/lib/validation";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  TextInput,
  type BadgeTone,
} from "@/components/ui";

const PATH = "/app/timesheets";

/** Add `n` whole days to a YYYY-MM-DD date (calendar math, tz-independent). */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD) of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  return addDays(dateStr, -(isoWeekday(dateStr) - 1));
}

/** A UTC instant rendered as a datetime-local value in the business tz. */
function toLocalInput(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Parse a "YYYY-MM-DDTHH:MM" datetime-local value to a UTC instant. */
function localInputToUtc(value: string, tz: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  return zonedDateTimeToUtc(m[1]!, m[2]!, tz);
}

/** A UTC instant's wall-clock time in the business tz as a friendly label. */
function localTime(instant: Date, tz: string): string {
  return formatTimeOnly(toLocalInput(instant, tz).slice(11));
}

/** Decimal-hours label ("6.1h") from a duration in ms. */
function hoursLabel(ms: number): string {
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

const GRID = "grid-cols-[1.7fr_.8fr_.9fr_.9fr_.7fr_1fr_1.5fr]";

type EntryStatus = "approved" | "pending" | "clocked_in" | "no_clock_out";

const STATUS_META: Record<EntryStatus, { tone: BadgeTone; label: string }> = {
  approved: { tone: "success", label: "Approved" },
  pending: { tone: "warning", label: "Pending" },
  clocked_in: { tone: "info", label: "Still clocked in" },
  no_clock_out: { tone: "danger", label: "No clock-out" },
};

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;

  const todayLocal = businessDateOf(new Date(), tz);
  const weekStart = sp.week ? mondayOf(sp.week) : mondayOf(todayLocal);
  const weekEnd = addDays(weekStart, 7);
  const startUtc = zonedDateTimeToUtc(weekStart, "00:00", tz);
  const endUtc = zonedDateTimeToUtc(weekEnd, "00:00", tz);

  const entries = await repo.listEntriesBetween(startUtc, endUtc);

  // Xero payroll: a lightweight entry point to the push flow (no live Xero
  // calls here — the heavy period preview lives on /app/xero/push).
  const xeroConnection = await repo.getXeroConnection();
  const xeroActive =
    xeroConnection?.status === "active" && !xeroConnection.needsReconnect;

  // Photo thumbnails, grouped by entry.
  const photos = await repo.listPhotosForEntries(entries.map((e) => e.id));
  const photosByEntry = new Map<string, { id: string; kind: "in" | "out" }[]>();
  for (const p of photos) {
    const list = photosByEntry.get(p.timesheetEntryId) ?? [];
    list.push({ id: p.id, kind: p.kind });
    photosByEntry.set(p.timesheetEntryId, list);
  }

  /** Derive the display status for one entry. */
  function statusOf(e: (typeof entries)[number]): EntryStatus {
    if (e.approved) return "approved";
    if (e.clockOutAt === null) {
      // Open entry: still on the clock today, or a stale one that needs fixing.
      return businessDateOf(e.clockInAt, tz) >= todayLocal
        ? "clocked_in"
        : "no_clock_out";
    }
    return "pending";
  }

  const rows = entries.map((e) => ({ entry: e, status: statusOf(e) }));
  const approvedCount = rows.filter((r) => r.status === "approved").length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const needsFixCount = rows.filter((r) => r.status === "no_clock_out").length;

  async function saveEntry(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const business = await repo.getBusiness();
    const tz = business?.timezone ?? DEFAULT_TIMEZONE;
    const id = String(formData.get("id"));
    const week = String(formData.get("week") ?? "");
    const back = `${PATH}${week ? `?week=${week}` : ""}`;

    const clockIn = localInputToUtc(String(formData.get("clockIn") ?? ""), tz);
    const outRaw = String(formData.get("clockOut") ?? "");
    const clockOut = outRaw ? localInputToUtc(outRaw, tz) : null;
    if (!clockIn || (outRaw && !clockOut)) {
      redirect(
        `${back}${week ? "&" : "?"}error=${encodeURIComponent("Check the dates and times")}`,
      );
    }
    if (clockOut && clockOut.getTime() <= clockIn!.getTime()) {
      redirect(
        `${back}${week ? "&" : "?"}error=${encodeURIComponent("Clock-out must be after clock-in")}`,
      );
    }

    // Unpaid break (None / 30 / 60) — deducted from worked hours. It can't be as
    // long as the shift (that would zero out the entry).
    const parsedBreak = breakMinutesSchema.safeParse(formData.get("break"));
    if (!parsedBreak.success) {
      redirect(
        `${back}${week ? "&" : "?"}error=${encodeURIComponent("Pick a valid break")}`,
      );
    }
    const breakMinutes = parsedBreak.data;
    if (
      clockOut &&
      breakMinutes * 60_000 >= clockOut.getTime() - clockIn!.getTime()
    ) {
      redirect(
        `${back}${week ? "&" : "?"}error=${encodeURIComponent("Break can't be as long as the shift")}`,
      );
    }

    await repo.updateEntry(id, {
      clockInAt: clockIn!,
      clockOutAt: clockOut,
      breakMinutes,
    });
    revalidatePath(PATH);
    redirect(`${back}${week ? "&" : "?"}saved=1`);
  }

  async function toggleApproved(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const approved = formData.get("approved") === "true";
    await repo.setEntryApproved(id, approved);
    revalidatePath(PATH);
  }

  async function deleteEntry(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    await repo.deleteEntry(String(formData.get("id")));
    revalidatePath(PATH);
  }

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle="Clock-in records from the kiosk and staff phones. Approve hours before export."
        action={
          <div className="text-right">
            <a
              href={`${PATH}/export?week=${weekStart}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[15px] py-[10px] text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[var(--color-bg)]"
            >
              <Icon name="download" className="text-[18px] text-[#5A7D17]" />
              Export approved hours (CSV)
            </a>
            <p className="ml-auto mt-[7px] max-w-[280px] text-[11px] leading-[1.4] text-[#9CA3AF]">
              Export shows approved hours × entered rates. Estimate only — not a
              payroll calculation.
            </p>
          </div>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.saved ? <Banner tone="success">Timesheet updated.</Banner> : null}

      {/* Xero payroll — push approved hours as DRAFT timesheets. */}
      {xeroConnection ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[16px] py-[13px] shadow-[0_1px_2px_rgba(17,24,39,.04)]">
          <span
            aria-hidden="true"
            className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-[#F4F8E9]"
          >
            <Icon name="sync_alt" className="text-[20px] text-[#5A7D17]" />
          </span>
          <div className="min-w-[180px] flex-1">
            <div className="text-[13.5px] font-bold text-[#111827]">
              Push approved hours to Xero
            </div>
            <div className="text-[12px] text-[#6B7280]">
              {xeroActive
                ? `Connected to ${xeroConnection.orgName} — sends DRAFT timesheets a human approves in Xero.`
                : xeroConnection.status === "pending_confirmation"
                  ? "Confirm your Xero organisation in Settings to enable pushing."
                  : "Xero needs reconnecting in Settings."}
            </div>
          </div>
          {xeroActive ? (
            <ButtonLink href="/app/xero/push" variant="secondary">
              Review &amp; push
            </ButtonLink>
          ) : (
            <ButtonLink href="/app/settings" variant="secondary">
              Open Settings
            </ButtonLink>
          )}
        </div>
      ) : null}

      {/* Filter row: week range (prev/next) + status chip + live tally. */}
      <div className="mb-4 mt-4 flex flex-wrap items-center gap-2.5">
        <div className="inline-flex items-center overflow-hidden rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <Link
            href={`${PATH}?week=${addDays(weekStart, -7)}`}
            aria-label="Previous week"
            className="flex h-[38px] w-9 items-center justify-center text-[#6B7280] hover:bg-[var(--color-bg)]"
          >
            <Icon name="chevron_left" className="text-[20px]" />
          </Link>
          <span className="flex items-center gap-2 border-x border-[var(--color-border)] px-[13px] py-2 text-[13px] font-medium text-[#374151]">
            <Icon name="date_range" className="text-[17px] text-[#9CA3AF]" />
            {formatDateOnly(weekStart)} –{" "}
            {formatDateOnly(addDays(weekStart, 6))}
          </span>
          <Link
            href={`${PATH}?week=${addDays(weekStart, 7)}`}
            aria-label="Next week"
            className="flex h-[38px] w-9 items-center justify-center text-[#6B7280] hover:bg-[var(--color-bg)]"
          >
            <Icon name="chevron_right" className="text-[20px]" />
          </Link>
        </div>

        <span className="inline-flex items-center gap-2 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[13px] py-2 text-[13px] font-medium text-[#374151]">
          <Icon name="filter_list" className="text-[17px] text-[#9CA3AF]" />
          All statuses
        </span>

        <div className="flex-1" />

        <div className="inline-flex items-center gap-3.5 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[14px] py-2 text-[12.5px] text-[#6B7280]">
          <span>
            <strong className="text-[#15803D]">{approvedCount}</strong> approved
          </span>
          <span>
            <strong className="text-[#B45309]">{pendingCount}</strong> pending
          </span>
          <span>
            <strong className="text-[#B91C1C]">{needsFixCount}</strong> needs
            fix
          </span>
        </div>
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState icon="schedule" title="No clock-ins this week">
            Records from the kiosk and staff phones appear here once your team
            starts clocking in.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[880px]">
              <div
                className={`grid ${GRID} border-b border-[var(--color-border)] bg-[#FAFBFC] px-[18px] py-[11px] font-archivo text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9CA3AF]`}
              >
                <span>Staff</span>
                <span>Day</span>
                <span>Clock in</span>
                <span>Clock out</span>
                <span>Hours</span>
                <span>Shift</span>
                <span className="text-right">Status</span>
              </div>

              {rows.map(({ entry: e, status }) => {
                const meta = STATUS_META[status];
                const entryPhotos = photosByEntry.get(e.id) ?? [];
                const open = e.clockOutAt === null;
                const hours =
                  status === "no_clock_out"
                    ? "—"
                    : hoursLabel(
                        entryDurationMs(
                          { clockInAt: e.clockInAt, clockOutAt: e.clockOutAt },
                          undefined,
                          e.breakMinutes,
                        ),
                      );
                return (
                  <div
                    key={e.id}
                    className="border-b border-[#F3F4F6] last:border-b-0"
                  >
                    <div
                      className={`grid ${GRID} items-center px-[18px] py-[11px] text-[13px] text-[#374151]`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar
                          name={e.staffName}
                          colorKey={e.staffMemberId}
                          size={28}
                        />
                        <span className="truncate font-semibold text-[#111827]">
                          {e.staffName}
                        </span>
                      </div>
                      <span className="text-[#6B7280]">
                        {formatDateOnly(businessDateOf(e.clockInAt, tz))}
                      </span>
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        {localTime(e.clockInAt, tz)}
                        {e.withinGeofence === false ? (
                          <span
                            title="Clocked in outside the geofence radius"
                            className="material-symbols-rounded text-[16px] text-[#D97706]"
                          >
                            wrong_location
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums text-[#374151]">
                        {open ? "—" : localTime(e.clockOutAt!, tz)}
                      </span>
                      <span className="font-archivo font-bold tabular-nums text-[#111827]">
                        {hours}
                        {e.breakMinutes > 0 && status !== "no_clock_out" ? (
                          <span className="block text-[10px] font-normal text-[#9CA3AF]">
                            &minus;{e.breakMinutes}m break
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-[12px] text-[#6B7280]">
                        {e.shiftLabel ?? "—"}
                      </span>
                      <div className="flex items-center justify-end gap-2.5">
                        {status === "pending" ? (
                          <form action={toggleApproved}>
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="approved" value="true" />
                            <button
                              type="submit"
                              className="font-semibold text-[12px] text-[#15803D] hover:underline"
                            >
                              Approve
                            </button>
                          </form>
                        ) : null}
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                    </div>

                    <details className="group px-[18px] pb-3">
                      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium text-[var(--color-brand)]">
                        <Icon
                          name="expand_more"
                          className="text-[16px] transition-transform group-open:rotate-180"
                        />
                        Edit / photos
                        {entryPhotos.length > 0 ? (
                          <span className="text-[#9CA3AF]">
                            · {entryPhotos.length} photo
                            {entryPhotos.length > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </summary>

                      <div className="mt-3 rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-bg)] p-4">
                        <p className="mb-3 text-[12px] text-[#6B7280]">
                          {e.shiftId
                            ? `Rostered: ${e.shiftLabel} ${formatTimeOnly(
                                e.shiftStartTime!.slice(0, 5),
                              )}–${formatTimeOnly(e.shiftEndTime!.slice(0, 5))}`
                            : "No rostered shift matched this clock-in."}
                        </p>

                        <form
                          action={saveEntry}
                          className="flex flex-wrap items-end gap-3"
                        >
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="week" value={weekStart} />
                          <Field label="Clock in">
                            <TextInput
                              type="datetime-local"
                              name="clockIn"
                              defaultValue={toLocalInput(e.clockInAt, tz)}
                              required
                            />
                          </Field>
                          <Field label="Clock out">
                            <TextInput
                              type="datetime-local"
                              name="clockOut"
                              defaultValue={
                                e.clockOutAt
                                  ? toLocalInput(e.clockOutAt, tz)
                                  : ""
                              }
                            />
                          </Field>
                          <Field label="Break (unpaid)">
                            <select
                              name="break"
                              defaultValue={String(e.breakMinutes ?? 0)}
                              className="block w-full rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-[14px] py-[11px] text-[14.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(118,185,0,0.16)]"
                            >
                              <option value="0">None</option>
                              <option value="30">30 min</option>
                              <option value="60">1 hour</option>
                            </select>
                          </Field>
                          <Button type="submit" variant="secondary">
                            Save
                          </Button>
                        </form>

                        {entryPhotos.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-3">
                            {entryPhotos.map((p) => (
                              <a
                                key={p.id}
                                href={`${PATH}/photo/${p.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`${PATH}/photo/${p.id}`}
                                  alt={`Clock ${p.kind} photo`}
                                  className="h-24 w-24 rounded-[10px] border border-[var(--color-border)] object-cover"
                                />
                                <span className="mt-1 block text-center text-[11px] text-[#6B7280]">
                                  Clock {p.kind}
                                </span>
                              </a>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-4 flex items-center gap-4">
                          <form action={toggleApproved}>
                            <input type="hidden" name="id" value={e.id} />
                            <input
                              type="hidden"
                              name="approved"
                              value={String(!e.approved)}
                            />
                            <button
                              type="submit"
                              className="text-[13px] font-medium text-[var(--color-brand)] hover:underline"
                            >
                              {e.approved ? "Unapprove" : "Approve"}
                            </button>
                          </form>
                          <form action={deleteEntry}>
                            <input type="hidden" name="id" value={e.id} />
                            <button
                              type="submit"
                              className="text-[13px] font-medium text-[var(--color-danger)] hover:underline"
                            >
                              Delete
                            </button>
                          </form>
                        </div>
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
