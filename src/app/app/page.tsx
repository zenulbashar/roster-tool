import Link from "next/link";
import { ownerRepo } from "@/lib/auth/context";
import {
  DEFAULT_TIMEZONE,
  businessDateOf,
  zonedDateTimeToUtc,
} from "@/lib/time";
import {
  aggregateLabour,
  formatAudCents,
  resolveWindow,
} from "@/lib/labour-report";
import { PageHeader, Card } from "@/components/ui";
import { buildGettingStarted } from "@/lib/getting-started";
import { GettingStartedCard } from "@/components/GettingStartedCard";

const links = [
  {
    href: "/app/periods",
    title: "Rosters",
    body: "Create a week, ask for availability, and publish the roster.",
  },
  {
    href: "/app/staff",
    title: "Staff",
    body: "Add the people who work for you and their email addresses.",
  },
  {
    href: "/app/templates",
    title: "Shift types",
    body: "Set up the shifts you run, like Morning or Evening.",
  },
];

export default async function DashboardPage() {
  // Compact current-week labour summary (read-only) for the home page.
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  // Setup checklist, derived from existing data; hidden once core steps done.
  const gettingStarted = buildGettingStarted(await repo.getSetupFlags());
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;
  const today = businessDateOf(new Date(), tz);
  const window = resolveWindow("current", { today });
  const startUtc = zonedDateTimeToUtc(window.startDate, "00:00", tz);
  const endUtc = zonedDateTimeToUtc(window.endDate, "00:00", tz);
  const report = aggregateLabour(
    await repo.listEntriesForLabourReport(startUtc, endUtc),
    window,
    tz,
  );
  const topStaff = [...report.perStaff]
    .sort(
      (a, b) =>
        b.approvedHours + b.pendingHours - (a.approvedHours + a.pendingHours),
    )
    .slice(0, 3);
  const hasHours =
    report.totals.approvedHours > 0 || report.totals.pendingHours > 0;

  return (
    <>
      <PageHeader title="Welcome" subtitle="What would you like to do?" />

      {gettingStarted.showChecklist ? (
        <GettingStartedCard data={gettingStarted} />
      ) : null}

      <Card className="mb-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">This week</h2>
          <Link
            href="/app/reports"
            className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
          >
            View full report →
          </Link>
        </div>
        {hasHours ? (
          <>
            <div className="mt-3 flex flex-wrap gap-8">
              <div>
                <p className="text-sm text-[var(--color-muted)]">
                  Approved hours
                </p>
                <p className="text-2xl font-bold tracking-tight">
                  {report.totals.approvedHours} h
                </p>
                {report.totals.pendingHours > 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">
                    + {report.totals.pendingHours} h pending
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-sm text-[var(--color-muted)]">
                  Estimated cost
                </p>
                <p className="text-2xl font-bold tracking-tight">
                  {formatAudCents(report.totals.estCostCents)}
                </p>
                <p className="text-sm text-[var(--color-muted)]">
                  estimate, not payroll
                </p>
              </div>
            </div>
            {topStaff.length > 0 ? (
              <ul className="mt-4 space-y-1 text-sm">
                {topStaff.map((s) => (
                  <li
                    key={s.staffMemberId}
                    className="flex justify-between gap-3"
                  >
                    <span>{s.staffName}</span>
                    <span className="tabular-nums text-[var(--color-muted)]">
                      {s.approvedHours + s.pendingHours} h
                      {s.estCostCents != null
                        ? ` · ${formatAudCents(s.estCostCents)}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No hours clocked yet this week.
          </p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="block">
            <Card className="h-full transition hover:border-[var(--color-brand)]">
              <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                {l.title}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{l.body}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
