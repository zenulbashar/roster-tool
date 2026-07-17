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
import { daysUntil } from "@/lib/certification";
import { relativeTime } from "@/lib/notifications";
import { Card, KpiTile, ButtonLink, Icon } from "@/components/ui";
import { buildGettingStarted } from "@/lib/getting-started";
import { GettingStartedCard } from "@/components/GettingStartedCard";

/**
 * Per-type icon chip for the recent-activity list. Purely decorative; mirrors
 * the header bell's token-backed palette. Unknown types fall back to a bell.
 */
const ACTIVITY_ICONS: Record<string, { icon: string; bg: string; fg: string }> =
  {
    leave_requested: {
      icon: "event_busy",
      bg: "var(--color-warning-bg)",
      fg: "var(--color-warning)",
    },
    shift_offer_activity: {
      icon: "swap_horiz",
      bg: "var(--color-success-bg)",
      fg: "var(--color-success)",
    },
    stock_needs_order: {
      icon: "inventory_2",
      bg: "var(--color-danger-bg)",
      fg: "var(--color-danger-strong)",
    },
    cert_expiring: {
      icon: "workspace_premium",
      bg: "var(--color-danger-bg)",
      fg: "var(--color-danger-strong)",
    },
    availability_reply: {
      icon: "how_to_reg",
      bg: "var(--color-success-bg)",
      fg: "var(--color-success)",
    },
    form_response: {
      icon: "description",
      bg: "var(--color-info-bg)",
      fg: "var(--color-info)",
    },
  };
const ACTIVITY_FALLBACK = {
  icon: "notifications",
  bg: "var(--color-bg)",
  fg: "var(--color-text-secondary)",
};

export default async function DashboardPage() {
  const repo = await ownerRepo();
  const business = await repo.getBusiness();
  // Setup checklist, derived from existing data; hidden once core steps done.
  const gettingStarted = buildGettingStarted(await repo.getSetupFlags());
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;
  const today = businessDateOf(new Date(), tz);

  // Time-of-day greeting in the business timezone (presentational only).
  const hour = Number(
    new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).format(new Date()),
  );
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = business?.name ?? "";

  // Current-week labour summary (read-only) — the cost basis for the KPIs.
  const window = resolveWindow("current", { today });
  const startUtc = zonedDateTimeToUtc(window.startDate, "00:00", tz);
  const endUtc = zonedDateTimeToUtc(window.endDate, "00:00", tz);
  const report = aggregateLabour(
    await repo.listEntriesForLabourReport(startUtc, endUtc),
    window,
    tz,
  );

  // "Week of 23 Jun" — the current window's Monday.
  const weekOf = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${window.startDate}T00:00:00Z`));

  const showChecklist = gettingStarted.showChecklist;

  // --- Established-state reads (cheap, read-only, for display only) ---------
  const [pendingLeave, upcomingLeave, certifications, recent] =
    await Promise.all([
      showChecklist ? Promise.resolve([]) : repo.listLeaveByStatus("pending"),
      showChecklist
        ? Promise.resolve([])
        : repo.listUpcomingApprovedLeave(today),
      showChecklist ? Promise.resolve([]) : repo.listCertifications(),
      showChecklist ? Promise.resolve([]) : repo.listRecentNotifications(3),
    ]);

  // On leave today: approved leave whose range covers today.
  const onLeaveToday = upcomingLeave.filter((l) => l.startDate <= today);
  // Certs expiring within the next month (0–31 days out), oldest first already.
  const certsExpiring = certifications.filter((c) => {
    const d = daysUntil(c.expiryDate, today);
    return d >= 0 && d <= 31;
  }).length;
  const pendingLeaveCount = pendingLeave.length;
  const now = new Date();

  // -------------------------------------------------------------------------
  // New-owner state: a warm welcome + the setup checklist only.
  // -------------------------------------------------------------------------
  if (showChecklist) {
    const remaining = Math.max(
      gettingStarted.coreTotal - gettingStarted.coreDoneCount,
      0,
    );
    return (
      <div className="max-w-[720px]">
        <h1 className="font-archivo text-[27px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
          Welcome to Roster{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mb-6 mt-2 text-[15px] leading-[1.5] text-[#4B5563]">
          You&rsquo;re{" "}
          <strong className="text-[#13301F]">
            {remaining} step{remaining === 1 ? "" : "s"}
          </strong>{" "}
          away from your first published roster. Knock these out and
          you&rsquo;re rostering in minutes.
        </p>
        <GettingStartedCard data={gettingStarted} />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Established state: greeting + KPIs + quick actions + recent activity.
  // -------------------------------------------------------------------------
  return (
    <>
      <div className="mb-[18px] flex flex-wrap items-baseline gap-3">
        <h1 className="font-archivo text-[27px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
          {greeting}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <span className="text-[15px] text-[var(--color-text-secondary)]">
          Week of {weekOf}
        </span>
      </div>

      <div className="mb-[18px] grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Hours this week"
          icon="schedule"
          value={`${report.totals.approvedHours}h`}
          valueColor="#13301F"
          sub={
            <>
              approved
              {report.totals.pendingHours > 0 ? (
                <>
                  {" · "}
                  <span className="font-semibold text-[#D97706]">
                    +{report.totals.pendingHours}h pending
                  </span>
                </>
              ) : null}
            </>
          }
        />
        <KpiTile
          label="Est. labour cost"
          icon="payments"
          value={`~${formatAudCents(report.totals.estCostCents)}`}
          sub={
            <span className="text-[var(--color-text-muted)]">
              estimate only — not payroll
            </span>
          }
        />
        <KpiTile
          label="On leave today"
          icon="beach_access"
          value={onLeaveToday.length}
          sub={
            onLeaveToday.length > 0
              ? onLeaveToday.map((l) => l.staffName).join(" · ")
              : "Nobody away"
          }
        />
        <KpiTile
          label="Certs expiring"
          icon="verified"
          iconColor="#2563EB"
          value={certsExpiring}
          valueColor="#2563EB"
          sub="this month →"
          href="/app/certifications"
        />
      </div>

      <div className="mb-[22px] flex flex-wrap gap-[11px]">
        <ButtonLink href="/app/periods" variant="primary">
          <Icon name="grid_view" className="text-[19px]" />
          Build roster
        </ButtonLink>
        <ButtonLink href="/app/timesheets" variant="secondary">
          <Icon
            name="schedule"
            className="text-[19px] text-[var(--color-text-muted)]"
          />
          View timesheets
        </ButtonLink>
        <ButtonLink href="/app/leave" variant="secondary">
          <Icon
            name="beach_access"
            className="text-[19px] text-[var(--color-text-muted)]"
          />
          Approve leave
          {pendingLeaveCount > 0 ? (
            <span className="font-archivo ml-0.5 rounded-full bg-[#FEF3E2] px-[7px] py-0.5 text-[11px] font-bold text-[#B45309]">
              {pendingLeaveCount}
            </span>
          ) : null}
        </ButtonLink>
      </div>

      <Card padded={false} className="max-w-[680px]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-[18px] py-[14px]">
          <h2 className="font-archivo text-[15px] font-bold text-[var(--color-text)]">
            Recent activity
          </h2>
          <Link
            href="/app/notifications"
            className="text-[12.5px] font-semibold text-[#2E7D4E] hover:underline"
          >
            View all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-[18px] py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
            No recent activity yet.
          </p>
        ) : (
          <ul>
            {recent.map((n) => {
              const chip = ACTIVITY_ICONS[n.type] ?? ACTIVITY_FALLBACK;
              return (
                <li key={n.id}>
                  <Link
                    href={n.linkPath ?? "/app/notifications"}
                    className="flex gap-3 border-b border-[var(--color-border-subtle)] px-[18px] py-[14px] last:border-b-0 hover:bg-[var(--color-bg)]"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[9px]"
                      style={{ background: chip.bg }}
                    >
                      <span
                        className="material-symbols-rounded text-[18px]"
                        style={{ color: chip.fg }}
                      >
                        {chip.icon}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-[var(--color-text)]">
                        {n.title}
                      </span>
                      {n.body ? (
                        <span className="mt-px block text-[12.5px] text-[#4B5563]">
                          {n.body}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap text-[11px] text-[var(--color-text-muted)]">
                      {relativeTime(n.createdAt, now)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
