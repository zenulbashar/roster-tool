import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { redirect } from "next/navigation";
import { xeroClient, type XeroPayrollCalendar } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import {
  XeroPayrollAdminRequired,
  XeroReconnectRequired,
} from "@/lib/xero/errors";
import {
  classifyEntries,
  mondayOfWeek,
  toActivePayRules,
  type ClassifiedLine,
  type ShiftBreakdown,
} from "@/lib/xero/pay-rules";
import {
  zonedDateTimeToUtc,
  formatDateOnly,
  formatDateRange,
  DEFAULT_TIMEZONE,
} from "@/lib/time";
import { logger } from "@/lib/logger";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ButtonLink,
  Card,
  PageHeader,
} from "@/components/ui";
import { pushAllAction, cancelPushAction } from "./actions";

export const dynamic = "force-dynamic";

const RATE_NOTE =
  "Hours push under each person's ordinary pay item, except where YOUR pay rules move them onto another of YOUR Xero pay items — Roster sets no rates and calculates no pay. Open a row to see exactly how each shift was split. Review each draft in Xero, then approve and run pay there. Roster never finalises pay.";

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

export default async function XeroPushPage({
  searchParams,
}: {
  searchParams: Promise<{
    pushed?: string;
    failed?: string;
    skipped?: string;
    blocked?: string;
    cancelled?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const owner = await requireOwner();
  const repo = createTenantRepo(owner.businessId);
  const business = await repo.getBusiness();
  if (!business) redirect("/onboarding");
  const tz = business.timezone ?? DEFAULT_TIMEZONE;

  const connection = await repo.getXeroConnection();
  if (
    !connection ||
    connection.status !== "active" ||
    connection.needsReconnect
  ) {
    return (
      <Gate
        title={connection ? "Finish connecting Xero" : "Connect Xero first"}
        body="Connect and confirm your Xero organisation in Settings before pushing hours."
      />
    );
  }

  const maps = await repo.listXeroEmployeeMaps();
  if (maps.length === 0) {
    return (
      <Gate
        title="Map staff to Xero first"
        body="Map your staff to their Xero employees, then push their approved hours here."
        cta={{ href: "/app/xero", label: "Map staff" }}
      />
    );
  }

  // --- Build the preview (live) -----------------------------------------
  type Row = {
    staffId: string;
    name: string;
    employeeName: string;
    period: string | null;
    hours: number;
    rateName: string | null;
    status: "ready" | "no_rate" | "no_period" | "no_hours";
    push?: { status: string; xeroTimesheetId: string | null; id: string };
    lines: ClassifiedLine[];
    breakdown: ShiftBreakdown[];
  };
  const rows: Row[] = [];
  let loadError: string | null = null;
  let staleRuleName: string | null = null;
  const staff = await repo.listStaff({ activeOnly: true });
  const nameOf = (id: string) =>
    staff.find((s) => s.id === id)?.name ?? "Former staff";
  const rules = toActivePayRules(await repo.listPayRules());
  const liveRateNames = new Map<string, string>();

  try {
    const accessToken = await ensureFreshXeroAccessToken({
      repo,
      client: xeroClient,
      connection,
    });
    const tenantId = connection.xeroTenantId;
    const rates = await xeroClient.listEarningsRates(accessToken, tenantId);
    for (const r of rates) liveRateNames.set(r.earningsRateId, r.name);
    const rateName = (id: string | null) =>
      id ? (liveRateNames.get(id) ?? "Rate") : null;

    // A rule pointing at a pay item that no longer exists in Xero blocks the
    // push (named + fixable) — never a silent skip or a cryptic Xero error.
    staleRuleName =
      rules.find((r) => !liveRateNames.has(r.earningsRateId))?.name ?? null;

    const calCache = new Map<string, XeroPayrollCalendar | null>();
    const getCal = async (id: string) => {
      if (!calCache.has(id))
        calCache.set(
          id,
          await xeroClient.getPayrollCalendar(accessToken, tenantId, id),
        );
      return calCache.get(id) ?? null;
    };

    // Cache period-window entries + existing push rows per (start,end).
    const entriesCache = new Map<
      string,
      Awaited<ReturnType<typeof repo.listApprovedClosedEntriesForPush>>
    >();
    const pushCache = new Map<
      string,
      Awaited<ReturnType<typeof repo.listXeroPushesForPeriod>>
    >();

    for (const m of maps) {
      const base: Row = {
        staffId: m.staffMemberId,
        name: nameOf(m.staffMemberId),
        employeeName: m.xeroEmployeeName,
        period: null,
        hours: 0,
        rateName: rateName(m.earningsRateId),
        status: "no_rate",
        lines: [],
        breakdown: [],
      };
      if (!m.earningsRateId) {
        rows.push(base);
        continue;
      }
      const cal = m.payrollCalendarId
        ? await getCal(m.payrollCalendarId)
        : null;
      if (!cal?.periodStartDate || !cal?.periodEndDate) {
        rows.push({ ...base, status: "no_period" });
        continue;
      }
      const key = `${cal.periodStartDate}|${cal.periodEndDate}`;
      if (!entriesCache.has(key)) {
        // Reach back to the Monday of the period-start week so weekly rules
        // see the whole business-local week (context only — no extra lines).
        const startUtc = zonedDateTimeToUtc(
          mondayOfWeek(cal.periodStartDate),
          "00:00",
          tz,
        );
        const endUtc = zonedDateTimeToUtc(
          nextDay(cal.periodEndDate),
          "00:00",
          tz,
        );
        entriesCache.set(
          key,
          await repo.listApprovedClosedEntriesForPush(startUtc, endUtc),
        );
        pushCache.set(
          key,
          await repo.listXeroPushesForPeriod(
            cal.periodStartDate,
            cal.periodEndDate,
          ),
        );
      }
      const staffEntries = entriesCache
        .get(key)!
        .filter((e) => e.staffMemberId === m.staffMemberId);
      const classified = classifyEntries({
        entries: staffEntries,
        rules,
        ordinaryEarningsRateId: m.earningsRateId,
        timezone: tz,
        periodStart: cal.periodStartDate,
        periodEnd: cal.periodEndDate,
      });
      const push = pushCache
        .get(key)!
        .find((p) => p.staffMemberId === m.staffMemberId);
      rows.push({
        ...base,
        period: formatDateRange(cal.periodStartDate, cal.periodEndDate),
        hours: classified.totalHours,
        status: classified.totalHours > 0 ? "ready" : "no_hours",
        lines: classified.lines,
        breakdown: classified.breakdown,
        push: push
          ? {
              status: push.status,
              xeroTimesheetId: push.xeroTimesheetId,
              id: push.id,
            }
          : undefined,
      });
    }
  } catch (err) {
    if (err instanceof XeroReconnectRequired) {
      return (
        <Gate
          title="Reconnect Xero"
          body="Your Xero access expired or was revoked. Reconnect in Settings to continue."
        />
      );
    }
    if (err instanceof XeroPayrollAdminRequired) loadError = err.message;
    else {
      logger.error({ err }, "Xero push preview failed");
      loadError = "Couldn’t load pay periods from Xero. Please try again.";
    }
  }

  const readyCount = rows.filter((r) => r.status === "ready").length;
  const pushedFlash = Number(sp.pushed ?? 0);
  const localTime = timeFormatter(tz);
  const lineName = (l: ClassifiedLine, ordinaryName: string | null) =>
    liveRateNames.get(l.earningsRateId) ??
    l.earningsRateName ??
    ordinaryName ??
    "Pay item";
  const grid = "grid grid-cols-[1.3fr_1.2fr_1.3fr_0.7fr_1.1fr] gap-3";

  const rowCells = (r: (typeof rows)[number], expandable: boolean) => (
    <>
      <div className="flex items-center gap-[10px]">
        <Avatar name={r.name} colorKey={r.staffId} size={30} />
        <span className="truncate text-[13.5px] font-semibold text-[#111827]">
          {r.name}
        </span>
        {expandable ? (
          <span
            aria-hidden
            className="material-symbols-rounded text-[18px] text-[#9CA3AF] transition-transform group-open:rotate-180"
          >
            expand_more
          </span>
        ) : null}
      </div>
      <span className="truncate text-[13px] text-[#374151]">
        {r.employeeName}
      </span>
      <span className="text-[12.5px] text-[#6B7280]">{r.period ?? "—"}</span>
      <span className="text-right font-archivo text-[13.5px] font-bold tabular-nums text-[#111827]">
        {r.status === "ready" || r.hours > 0 ? `${r.hours}h` : "—"}
      </span>
      <div className="flex items-center justify-end gap-2">
        <RowStatus row={r} />
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title="Push hours to Xero"
        subtitle={`Connected to ${connection.orgName}. Approved hours push as DRAFT timesheets for each employee's Xero pay period.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/app/xero/rules" variant="secondary">
              Pay rules
            </ButtonLink>
            <ButtonLink href="/app/xero" variant="secondary">
              Staff mapping
            </ButtonLink>
          </div>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {loadError ? <Banner tone="warn">{loadError}</Banner> : null}
      {sp.cancelled ? (
        <Banner tone="success">Draft removed from Xero.</Banner>
      ) : null}
      {sp.pushed !== undefined ? (
        <Banner tone={pushedFlash > 0 ? "success" : "info"}>
          Pushed {pushedFlash} draft timesheet{pushedFlash === 1 ? "" : "s"} to
          Xero
          {Number(sp.failed) ? ` · ${sp.failed} failed` : ""}
          {Number(sp.skipped) ? ` · ${sp.skipped} with no hours` : ""}
          {Number(sp.blocked) ? ` · ${sp.blocked} blocked` : ""}.
        </Banner>
      ) : null}

      <Banner tone="info">{RATE_NOTE}</Banner>
      {staleRuleName ? (
        <Banner tone="warn">
          The rule “{staleRuleName}” points at a pay item that no longer exists
          in Xero. Fix or turn it off on the Pay rules page — pushing is paused
          until then.
        </Banner>
      ) : null}

      <Card padded={false}>
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div
              className={`${grid} border-b border-[#F1F3F5] bg-[#FAFBFC] px-[18px] py-[11px] text-[11px] font-bold uppercase tracking-[.06em] text-[#6B7280]`}
            >
              <span>Staff member</span>
              <span>Xero employee</span>
              <span>Pay period</span>
              <span className="text-right">Hours</span>
              <span className="text-right">Status</span>
            </div>
            {rows.map((r) =>
              r.lines.length > 0 ? (
                <details
                  key={r.staffId}
                  className="group border-b border-[#F5F6F7]"
                >
                  <summary
                    className={`${grid} cursor-pointer list-none items-center px-[18px] py-[12px] hover:bg-[#FAFBFC] [&::-webkit-details-marker]:hidden`}
                  >
                    {rowCells(r, true)}
                  </summary>
                  <div className="border-t border-[#F5F6F7] bg-[#FAFBFC] px-[18px] py-[14px]">
                    <div className="grid gap-[18px] lg:grid-cols-2">
                      <div>
                        <h3 className="mb-[8px] text-[11px] font-bold uppercase tracking-[.06em] text-[#6B7280]">
                          Lines that will be sent
                        </h3>
                        <ul className="grid gap-[6px]">
                          {r.lines.map((l, i) => (
                            <li
                              key={`${l.date}-${l.earningsRateId}-${i}`}
                              className="flex flex-wrap items-baseline gap-x-[8px] text-[12.5px] text-[#374151]"
                            >
                              <span className="w-[92px] shrink-0 text-[#6B7280]">
                                {formatDateOnly(l.date)}
                              </span>
                              <span className="font-archivo font-bold tabular-nums">
                                {l.numberOfUnits}h
                              </span>
                              <span>→ {lineName(l, r.rateName)}</span>
                              {l.ruleNames.length > 0 ? (
                                <span className="text-[11.5px] text-[#9CA3AF]">
                                  via {l.ruleNames.join(", ")}
                                </span>
                              ) : (
                                <span className="text-[11.5px] text-[#9CA3AF]">
                                  ordinary
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="mb-[8px] text-[11px] font-bold uppercase tracking-[.06em] text-[#6B7280]">
                          How each shift was classified
                        </h3>
                        <ul className="grid gap-[10px]">
                          {r.breakdown.map((b, i) => (
                            <li
                              key={i}
                              className="text-[12.5px] text-[#374151]"
                            >
                              <div className="font-semibold text-[#111827]">
                                {formatDateOnly(b.date)} ·{" "}
                                {localTime(b.clockInAt)} –{" "}
                                {localTime(b.clockOutAt)} · {b.hours}h
                              </div>
                              <ul className="mt-[3px] grid gap-[2px] pl-[14px]">
                                {b.segments.map((s, j) => (
                                  <li key={j} className="text-[12px]">
                                    {localTime(s.startUtc)} –{" "}
                                    {localTime(s.endUtc)} · {s.hours}h →{" "}
                                    {s.ruleName ? (
                                      <>
                                        <span className="font-semibold">
                                          {liveRateNames.get(
                                            s.earningsRateId,
                                          ) ?? s.earningsRateName}
                                        </span>{" "}
                                        <span className="text-[#9CA3AF]">
                                          (rule: {s.ruleName})
                                        </span>
                                      </>
                                    ) : (
                                      <span>
                                        {r.rateName ?? "ordinary pay item"}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </details>
              ) : (
                <div
                  key={r.staffId}
                  className={`${grid} items-center border-b border-[#F5F6F7] px-[18px] py-[12px]`}
                >
                  {rowCells(r, false)}
                </div>
              ),
            )}
          </div>
        </div>
      </Card>

      <div className="mt-[16px] flex flex-wrap items-center gap-3">
        <form action={pushAllAction}>
          <Button
            type="submit"
            disabled={readyCount === 0 || staleRuleName !== null}
          >
            Push {readyCount > 0 ? `${readyCount} ` : ""}approved timesheet
            {readyCount === 1 ? "" : "s"} to Xero
          </Button>
        </form>
        <span className="text-[12px] text-[#9CA3AF]">
          Re-pushing replaces an existing draft (only while it’s still a draft
          in Xero).
        </span>
      </div>
    </>
  );
}

/** "9:00 am"-style business-local time for a UTC instant. */
function timeFormatter(tz: string): (d: Date) => string {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return (d: Date) => fmt.format(d).replace(/\u202f/g, " ");
}

function RowStatus({
  row,
}: {
  row: {
    status: string;
    push?: { status: string; xeroTimesheetId: string | null; id: string };
  };
}) {
  if (row.push?.status === "draft" && row.push.xeroTimesheetId) {
    return (
      <>
        <Badge tone="success">Draft in Xero</Badge>
        <form action={cancelPushAction}>
          <input type="hidden" name="pushId" value={row.push.id} />
          <button
            type="submit"
            className="text-[11.5px] font-semibold text-[#B91C1C] hover:underline"
          >
            Remove
          </button>
        </form>
      </>
    );
  }
  if (row.push?.status === "failed") {
    return <Badge tone="danger">No draft — re-push</Badge>;
  }
  if (row.push?.status === "cancelled") {
    return <Badge tone="draft">Cancelled</Badge>;
  }
  if (row.status === "no_rate")
    return <Badge tone="warning">Pick a rate</Badge>;
  if (row.status === "no_period")
    return <Badge tone="warning">No Xero period</Badge>;
  if (row.status === "no_hours")
    return <Badge tone="draft">No approved hours</Badge>;
  return <Badge tone="ok">Ready</Badge>;
}

function Gate({
  title,
  body,
  cta = { href: "/app/settings", label: "Go to Settings" },
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <>
      <PageHeader title="Push hours to Xero" />
      <Card>
        <div className="py-[10px] text-center">
          <h2 className="font-archivo text-[17px] font-bold text-[#111827]">
            {title}
          </h2>
          <p className="mx-auto mt-[8px] max-w-[420px] text-[13px] leading-[1.6] text-[#6B7280]">
            {body}
          </p>
          <div className="mt-[16px]">
            <ButtonLink href={cta.href}>{cta.label}</ButtonLink>
          </div>
        </div>
      </Card>
    </>
  );
}
