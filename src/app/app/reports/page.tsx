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
import {
  Button,
  Card,
  Icon,
  KpiTile,
  PageHeader,
  TextInput,
} from "@/components/ui";
import { avatarColor, initials } from "@/lib/avatar";

const PATH = "/app/reports";

function parsePreset(value: string | undefined): WindowPreset {
  return value === "last4" || value === "custom" ? value : "current";
}

/** A compact hours number as "142h" / "1.5h" (design style). */
function hoursText(n: number): string {
  return `${n}h`;
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
    ...report.weekly.map((w) => w.approvedHours),
  );

  // Segmented-control styling for the window presets.
  const seg = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-[8px] px-[14px] py-[7px] text-[12.5px] font-semibold transition-colors ${
      active
        ? "bg-white text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,24,39,0.10)]"
        : "text-[var(--color-text-muted)] hover:text-[var(--color-ink)]"
    }`;

  return (
    <>
      <PageHeader
        title="Labour & hours"
        subtitle="Approved hours and an estimated labour cost. Always an estimate — never a payroll figure."
      />

      {/* Window picker: segmented presets. */}
      <nav
        aria-label="Time window"
        className="mb-[18px] inline-flex gap-[2px] rounded-[10px] border border-[var(--color-border)] bg-[#F3F4F6] p-[3px]"
      >
        <Link
          href={PATH}
          className={seg(window.preset === "current")}
          aria-current={window.preset === "current" ? "page" : undefined}
        >
          This week
        </Link>
        <Link
          href={`${PATH}?window=last4`}
          className={seg(window.preset === "last4")}
          aria-current={window.preset === "last4" ? "page" : undefined}
        >
          Last 4 weeks
        </Link>
        <Link
          href={`${PATH}?window=custom`}
          className={seg(window.preset === "custom")}
          aria-current={window.preset === "custom" ? "page" : undefined}
        >
          Custom range
          <Icon name="expand_more" className="text-[15px]" />
        </Link>
      </nav>

      {/* Custom range form — shown only when the custom preset is active. */}
      {window.preset === "custom" ? (
        <Card className="mb-[18px]">
          <form
            method="get"
            action={PATH}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="window" value="custom" />
            <label className="block">
              <span className="mb-[7px] block text-[12.5px] font-semibold text-[#374151]">
                From
              </span>
              <TextInput
                type="date"
                name="from"
                defaultValue={window.startDate}
                className="w-auto"
              />
            </label>
            <label className="block">
              <span className="mb-[7px] block text-[12.5px] font-semibold text-[#374151]">
                To
              </span>
              <TextInput
                type="date"
                name="to"
                defaultValue={lastDay}
                className="w-auto"
              />
            </label>
            <Button type="submit" variant="secondary">
              Apply range
            </Button>
            <span className="text-[12.5px] text-[var(--color-text-muted)]">
              Showing {rangeLabel}
            </span>
          </form>
        </Card>
      ) : null}

      {/* Headline KPIs. */}
      <div className="mb-[18px] grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Total approved hours"
          value={hoursText(report.totals.approvedHours)}
          valueColor="#3F6212"
          sub={`across ${report.perStaff.length} staff`}
        />
        <KpiTile
          label="Estimated labour cost"
          value={formatAudCents(report.totals.estCostCents)}
          sub={
            <span className="flex items-center gap-1 text-[#D97706]">
              <Icon name="warning" className="text-[15px]" />
              Estimate — hours × rates only
            </span>
          }
        />
        <KpiTile
          label="Pending (not costed)"
          value={`+${hoursText(report.totals.pendingHours)}`}
          valueColor="#B45309"
          sub="awaiting approval"
        />
        <KpiTile
          label="Staff without rates"
          value={
            <span className="flex items-center gap-[7px]">
              {report.totals.staffWithoutRateCount}
              {report.totals.staffWithoutRateCount > 0 ? (
                <Icon name="warning" className="text-[22px] text-[#D97706]" />
              ) : null}
            </span>
          }
          sub="cost not estimated"
        />
      </div>

      {report.totals.openEntryCount > 0 ? (
        <p className="mb-[18px] text-[12.5px] text-[var(--color-text-muted)]">
          {report.totals.openEntryCount} entr
          {report.totals.openEntryCount === 1 ? "y is" : "ies are"} still
          clocked in and not counted.
        </p>
      ) : null}

      {/* Two-column: weekly bars + per-staff cost table. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        {/* Approved hours by week. */}
        <Card>
          <h2 className="mb-[18px] font-archivo text-[15px] font-bold text-[var(--color-ink)]">
            Approved hours by week
          </h2>
          {report.weekly.length === 0 ? (
            <p className="text-[12.5px] text-[var(--color-text-muted)]">
              No hours in this period.
            </p>
          ) : (
            <ul className="space-y-4">
              {report.weekly.map((w) => {
                const pct = Math.round((w.approvedHours / maxWeekHours) * 100);
                const isCurrent =
                  w.weekStart <= today && today < addDays(w.weekStart, 7);
                return (
                  <li key={w.weekStart}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[12.5px] font-semibold text-[#374151]">
                        Wk of {formatDateOnly(w.weekStart)}
                      </span>
                      <span className="text-[12px] tabular-nums text-[var(--color-text-secondary)]">
                        <strong className="font-archivo text-[var(--color-ink)]">
                          {hoursText(w.approvedHours)}
                        </strong>{" "}
                        · {formatAudCents(w.estCostCents)}
                      </span>
                    </div>
                    <div
                      className="h-[12px] w-full overflow-hidden rounded-[7px] bg-[#F3F4F6]"
                      role="img"
                      aria-label={`${hoursText(w.approvedHours)} approved`}
                    >
                      <div
                        className="h-full rounded-[7px]"
                        style={{
                          width: `${pct}%`,
                          background: isCurrent ? "#76b900" : "#C5DC8C",
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 border-t border-[#F3F4F6] pt-3 text-[11.5px] text-[var(--color-text-muted)]">
            Costs are estimates (approved hours × entered rates). Pending hours
            are not included.
          </p>
        </Card>

        {/* Per-staff cost table. */}
        <Card padded={false}>
          <div className="grid grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr] items-center border-b border-[var(--color-border)] bg-[#FAFBFC] px-[18px] py-[11px] font-archivo text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9CA3AF]">
            <span>Staff</span>
            <span>Rate</span>
            <span className="text-right">Hours</span>
            <span className="text-right">Est. cost</span>
          </div>
          {report.perStaff.length === 0 ? (
            <p className="px-[18px] py-4 text-[13px] text-[var(--color-text-muted)]">
              No hours in this period.
            </p>
          ) : (
            report.perStaff.map((s) => (
              <div
                key={s.staffMemberId}
                className="grid grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr] items-center border-b border-[#F3F4F6] px-[18px] py-[11px] text-[13px] last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-[9px]">
                  <span
                    aria-hidden="true"
                    className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full font-archivo text-[10.5px] font-bold text-white"
                    style={{ background: avatarColor(s.staffMemberId) }}
                  >
                    {initials(s.staffName)}
                  </span>
                  <span className="truncate font-semibold text-[var(--color-ink)]">
                    {s.staffName}
                  </span>
                </div>
                <div>{rateCell(s)}</div>
                <span className="text-right font-archivo font-bold tabular-nums text-[var(--color-ink)]">
                  {hoursText(s.approvedHours)}
                </span>
                <span className="text-right tabular-nums text-[#374151]">
                  {s.estCostCents == null
                    ? "—"
                    : formatAudCents(s.estCostCents)}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <p className="mt-[18px] text-[12.5px] text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-ink)]">Estimate only.</strong>{" "}
        {LABOUR_COST_DISCLAIMER}
      </p>
    </>
  );
}

/** The rate cell: an amber "No rate set" chip, or the entered hourly rate. */
function rateCell(s: StaffLabour) {
  if (s.payRateCents == null) {
    return (
      <span className="inline-flex rounded-[6px] border border-[#FED7AA] bg-[#FEF3E2] px-[7px] py-[2px] text-[11px] font-bold text-[#B45309]">
        No rate set
      </span>
    );
  }
  return (
    <span
      className="tabular-nums text-[#374151]"
      title={s.rateLabel ?? undefined}
    >
      {formatAudCents(s.payRateCents)}
    </span>
  );
}
