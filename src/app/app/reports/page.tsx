import Link from "next/link";
import { ownerRepo } from "@/lib/auth/context";
import {
  DEFAULT_TIMEZONE,
  businessDateOf,
  formatDateOnly,
  zonedDateTimeToUtc,
} from "@/lib/time";
import {
  addDays,
  aggregateLabour,
  formatAudCents,
  resolveWindow,
  LABOUR_COST_DISCLAIMER,
  type WindowPreset,
  type StaffLabour,
} from "@/lib/labour-report";
import { Banner, Card, PageHeader } from "@/components/ui";

const PATH = "/app/reports";

function parsePreset(value: string | undefined): WindowPreset {
  return value === "last4" || value === "custom" ? value : "current";
}

/** A rounded hours number as "8 h" / "1.5 h". */
function hoursText(n: number): string {
  return `${n} h`;
}

/** The human rate string for a staff row, e.g. "$25.00/h (Weekend)". */
function rateText(s: StaffLabour): string {
  if (s.payRateCents == null) return "No rate set";
  const base = `${formatAudCents(s.payRateCents)}/h`;
  return s.rateLabel ? `${base} (${s.rateLabel})` : base;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;

  const today = businessDateOf(new Date(), tz);
  const preset = parsePreset(sp.window);
  const window = resolveWindow(preset, {
    today,
    from: sp.from,
    to: sp.to,
  });
  const startUtc = zonedDateTimeToUtc(window.startDate, "00:00", tz);
  const endUtc = zonedDateTimeToUtc(window.endDate, "00:00", tz);

  const entries = await repo.listEntriesForLabourReport(startUtc, endUtc);
  const report = aggregateLabour(entries, window, tz);

  const lastDay = addDays(window.endDate, -1);
  const rangeLabel = `${formatDateOnly(window.startDate)} – ${formatDateOnly(lastDay)}`;
  const maxWeekHours = Math.max(
    1,
    ...report.weekly.map((w) => w.approvedHours + w.pendingHours),
  );

  // Active-preset styling for the quick links.
  const tab = (active: boolean) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${
      active
        ? "bg-[var(--color-brand)] text-[var(--color-brand-ink)]"
        : "border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-canvas)]"
    }`;

  return (
    <>
      <PageHeader
        title="Hours & cost"
        subtitle="Worked hours and estimated labour cost from your timesheets."
      />

      {/* Window picker: quick presets + a custom range form. */}
      <nav aria-label="Time window" className="mt-2 flex flex-wrap gap-2">
        <Link
          href={PATH}
          className={tab(window.preset === "current")}
          aria-current={window.preset === "current" ? "page" : undefined}
        >
          This week
        </Link>
        <Link
          href={`${PATH}?window=last4`}
          className={tab(window.preset === "last4")}
          aria-current={window.preset === "last4" ? "page" : undefined}
        >
          Last 4 weeks
        </Link>
      </nav>

      <Card className="mt-3">
        <form
          method="get"
          action={PATH}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="window" value="custom" />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">From</span>
            <input
              type="date"
              name="from"
              defaultValue={window.startDate}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">To</span>
            <input
              type="date"
              name="to"
              defaultValue={lastDay}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm font-semibold hover:bg-[var(--color-canvas)]"
          >
            Apply range
          </button>
          <span className="text-sm text-[var(--color-muted)]">
            Showing {rangeLabel}
          </span>
        </form>
      </Card>

      {/* Headline totals. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-[var(--color-muted)]">
            Estimated labour cost
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            {formatAudCents(report.totals.estCostCents)}
          </p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            from {hoursText(report.totals.approvedHours)} approved
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--color-muted)]">Approved hours</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            {hoursText(report.totals.approvedHours)}
          </p>
          {report.totals.pendingHours > 0 ? (
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              + {hoursText(report.totals.pendingHours)} pending approval (not
              costed)
            </p>
          ) : null}
        </Card>
      </div>

      <p className="mt-3 text-sm text-[var(--color-muted)]">
        <strong className="text-[var(--color-ink)]">Estimate only.</strong>{" "}
        {LABOUR_COST_DISCLAIMER}
      </p>

      {report.totals.staffWithoutRateCount > 0 ? (
        <div className="mt-3">
          <Banner tone="warn">
            {report.totals.staffWithoutRateCount} staff have no pay rate set —
            their hours are shown but not included in the cost. Set a rate on
            the Staff page to include them.
          </Banner>
        </div>
      ) : null}
      {report.totals.openEntryCount > 0 ? (
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {report.totals.openEntryCount} entr
          {report.totals.openEntryCount === 1 ? "y is" : "ies are"} still
          clocked in and not counted.
        </p>
      ) : null}

      {/* Per-staff breakdown. */}
      <h2 className="mt-8 text-lg font-semibold">By staff member</h2>
      {report.perStaff.length === 0 ? (
        <Card className="mt-3 text-center text-[var(--color-muted)]">
          No hours in this period.
        </Card>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Staff
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Rate
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Approved
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Pending
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Est. cost
                </th>
              </tr>
            </thead>
            <tbody>
              {report.perStaff.map((s) => (
                <tr
                  key={s.staffMemberId}
                  className="border-b border-[var(--color-line)]"
                >
                  <th scope="row" className="py-2 pr-3 font-medium">
                    {s.staffName}
                  </th>
                  <td className="py-2 pr-3 text-[var(--color-muted)]">
                    {rateText(s)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {hoursText(s.approvedHours)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-muted)]">
                    {s.pendingHours > 0 ? hoursText(s.pendingHours) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {s.estCostCents == null ? (
                      <span className="text-[var(--color-warn)]">
                        No rate set
                      </span>
                    ) : (
                      formatAudCents(s.estCostCents)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="py-2 pr-3 text-left">
                  Total
                </th>
                <td className="py-2 pr-3" />
                <td className="py-2 pr-3 text-right tabular-nums">
                  {hoursText(report.totals.approvedHours)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {report.totals.pendingHours > 0
                    ? hoursText(report.totals.pendingHours)
                    : "—"}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatAudCents(report.totals.estCostCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Weekly trend — lightweight CSS bars (approved hours), no dependency. */}
      {report.weekly.length > 1 ? (
        <>
          <h2 className="mt-8 text-lg font-semibold">By week</h2>
          <Card className="mt-3">
            <ul className="space-y-3">
              {report.weekly.map((w) => {
                const total = w.approvedHours + w.pendingHours;
                const pct = Math.round((total / maxWeekHours) * 100);
                return (
                  <li key={w.weekStart}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">
                        Week of {formatDateOnly(w.weekStart)}
                      </span>
                      <span className="text-[var(--color-muted)] tabular-nums">
                        {hoursText(w.approvedHours)}
                        {w.pendingHours > 0
                          ? ` (+${hoursText(w.pendingHours)} pending)`
                          : ""}{" "}
                        · {formatAudCents(w.estCostCents)}
                      </span>
                    </div>
                    <div
                      className="mt-1 h-2 w-full rounded bg-[var(--color-canvas)]"
                      role="img"
                      aria-label={`${hoursText(w.approvedHours)} approved`}
                    >
                      <div
                        className="h-2 rounded bg-[var(--color-brand)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      ) : null}
    </>
  );
}
