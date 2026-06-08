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
import {
  entryDurationMs,
  formatElapsed,
  weeklyTotalsByStaff,
} from "@/lib/clock";
import { Banner, Button, Card, PageHeader } from "@/components/ui";

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
  const totals = weeklyTotalsByStaff(
    entries.map((e) => ({
      staffMemberId: e.staffMemberId,
      clockInAt: e.clockInAt,
      clockOutAt: e.clockOutAt,
    })),
  );

  // Photo thumbnails, grouped by entry.
  const photos = await repo.listPhotosForEntries(entries.map((e) => e.id));
  const photosByEntry = new Map<string, { id: string; kind: "in" | "out" }[]>();
  for (const p of photos) {
    const list = photosByEntry.get(p.timesheetEntryId) ?? [];
    list.push({ id: p.id, kind: p.kind });
    photosByEntry.set(p.timesheetEntryId, list);
  }

  // Group entries (already newest-first) by staff member.
  const groups = new Map<string, { name: string; entries: typeof entries }>();
  for (const e of entries) {
    const g = groups.get(e.staffMemberId) ?? { name: e.staffName, entries: [] };
    g.entries.push(e);
    groups.set(e.staffMemberId, g);
  }

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
    await repo.updateEntry(id, { clockInAt: clockIn!, clockOutAt: clockOut });
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
        subtitle="Hours your team clocked at the kiosk. Edit, approve and check the photos."
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.saved ? <Banner tone="success">Timesheet updated.</Banner> : null}

      <nav
        aria-label="Week"
        className="mt-4 flex items-center justify-between gap-3"
      >
        <Link
          href={`${PATH}?week=${addDays(weekStart, -7)}`}
          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          ← Previous
        </Link>
        <span className="font-semibold">
          Week of {formatDateOnly(weekStart)} –{" "}
          {formatDateOnly(addDays(weekStart, 6))}
        </span>
        <Link
          href={`${PATH}?week=${addDays(weekStart, 7)}`}
          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          Next →
        </Link>
      </nav>

      {groups.size === 0 ? (
        <Card className="mt-6 text-center text-[var(--color-muted)]">
          No clock-ins this week.
        </Card>
      ) : (
        <div className="mt-6 space-y-8">
          {[...groups.entries()].map(([staffId, group]) => (
            <section key={staffId} aria-label={group.name}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">{group.name}</h2>
                <span className="text-sm text-[var(--color-muted)]">
                  {formatElapsed(totals.get(staffId) ?? 0)} this week
                </span>
              </div>
              <ul className="space-y-2">
                {group.entries.map((e) => {
                  const open = e.clockOutAt === null;
                  const entryPhotos = photosByEntry.get(e.id) ?? [];
                  const duration = formatElapsed(
                    entryDurationMs({
                      clockInAt: e.clockInAt,
                      clockOutAt: e.clockOutAt,
                    }),
                  );
                  return (
                    <li key={e.id}>
                      <Card className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold">
                              {formatDateOnly(businessDateOf(e.clockInAt, tz))}
                            </p>
                            <p className="text-sm text-[var(--color-muted)]">
                              {formatTimeOnly(
                                toLocalInput(e.clockInAt, tz).slice(11),
                              )}
                              {" – "}
                              {open
                                ? "still in"
                                : formatTimeOnly(
                                    toLocalInput(e.clockOutAt!, tz).slice(11),
                                  )}
                              {" · "}
                              {open ? "open" : `${duration}`}
                            </p>
                            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                              {e.shiftId
                                ? `Rostered: ${e.shiftLabel} ${formatTimeOnly(
                                    e.shiftStartTime!.slice(0, 5),
                                  )}–${formatTimeOnly(e.shiftEndTime!.slice(0, 5))}`
                                : "No rostered shift"}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {e.approved ? (
                              <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-[var(--color-ok)]">
                                Approved
                              </span>
                            ) : null}
                            {entryPhotos.length > 0 ? (
                              <span className="text-xs text-[var(--color-muted)]">
                                {entryPhotos.length} photo
                                {entryPhotos.length > 1 ? "s" : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-medium text-[var(--color-brand)]">
                            Edit / manage
                          </summary>
                          <form
                            action={saveEntry}
                            className="mt-3 flex flex-wrap items-end gap-3"
                          >
                            <input type="hidden" name="id" value={e.id} />
                            <input
                              type="hidden"
                              name="week"
                              value={weekStart}
                            />
                            <label className="block">
                              <span className="mb-1 block text-sm font-semibold">
                                Clock in
                              </span>
                              <input
                                type="datetime-local"
                                name="clockIn"
                                defaultValue={toLocalInput(e.clockInAt, tz)}
                                required
                                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-sm font-semibold">
                                Clock out
                              </span>
                              <input
                                type="datetime-local"
                                name="clockOut"
                                defaultValue={
                                  e.clockOutAt
                                    ? toLocalInput(e.clockOutAt, tz)
                                    : ""
                                }
                                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                              />
                            </label>
                            <Button type="submit" variant="secondary">
                              Save
                            </Button>
                          </form>

                          {entryPhotos.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-3">
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
                                    className="h-24 w-24 rounded-lg border border-[var(--color-line)] object-cover"
                                  />
                                  <span className="mt-1 block text-center text-xs text-[var(--color-muted)]">
                                    Clock {p.kind}
                                  </span>
                                </a>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-3 flex gap-4">
                            <form action={toggleApproved}>
                              <input type="hidden" name="id" value={e.id} />
                              <input
                                type="hidden"
                                name="approved"
                                value={String(!e.approved)}
                              />
                              <button
                                type="submit"
                                className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                              >
                                {e.approved ? "Unapprove" : "Approve"}
                              </button>
                            </form>
                            <form action={deleteEntry}>
                              <input type="hidden" name="id" value={e.id} />
                              <button
                                type="submit"
                                className="text-sm font-medium text-[var(--color-danger)] underline underline-offset-2"
                              >
                                Delete
                              </button>
                            </form>
                          </div>
                        </details>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
