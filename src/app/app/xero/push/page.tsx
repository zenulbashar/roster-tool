import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { redirect } from "next/navigation";
import { xeroClient, type XeroPayrollCalendar } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import {
  XeroPayrollAdminRequired,
  XeroReconnectRequired,
} from "@/lib/xero/errors";
import { buildTimesheetLines } from "@/lib/xero/timesheet-lines";
import {
  zonedDateTimeToUtc,
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

const SINGLE_RATE_NOTE =
  "All hours push under a single ordinary earnings rate — Roster does not classify penalty, overtime or weekend rates. Review each draft in Xero, then approve and run pay there. Roster never finalises pay.";

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
  };
  const rows: Row[] = [];
  let loadError: string | null = null;
  const staff = await repo.listStaff({ activeOnly: true });
  const nameOf = (id: string) =>
    staff.find((s) => s.id === id)?.name ?? "Former staff";

  try {
    const accessToken = await ensureFreshXeroAccessToken({
      repo,
      client: xeroClient,
      connection,
    });
    const tenantId = connection.xeroTenantId;
    const rates = await xeroClient.listEarningsRates(accessToken, tenantId);
    const rateName = (id: string | null) =>
      id ? (rates.find((r) => r.earningsRateId === id)?.name ?? "Rate") : null;

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
        const startUtc = zonedDateTimeToUtc(cal.periodStartDate, "00:00", tz);
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
      const { totalHours } = buildTimesheetLines({
        entries: staffEntries,
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
        hours: totalHours,
        status: totalHours > 0 ? "ready" : "no_hours",
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

  return (
    <>
      <PageHeader
        title="Push hours to Xero"
        subtitle={`Connected to ${connection.orgName}. Approved hours push as DRAFT timesheets for each employee's Xero pay period.`}
        action={
          <ButtonLink href="/app/xero" variant="secondary">
            Staff mapping
          </ButtonLink>
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

      <Banner tone="info">{SINGLE_RATE_NOTE}</Banner>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[1.3fr_1.2fr_1.3fr_0.7fr_1.1fr] gap-3 border-b border-[#F1F3F5] bg-[#FAFBFC] px-[18px] py-[11px] text-[11px] font-bold uppercase tracking-[.06em] text-[#6B7280]">
              <span>Staff member</span>
              <span>Xero employee</span>
              <span>Pay period</span>
              <span className="text-right">Hours</span>
              <span className="text-right">Status</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.staffId}
                className="grid grid-cols-[1.3fr_1.2fr_1.3fr_0.7fr_1.1fr] items-center gap-3 border-b border-[#F5F6F7] px-[18px] py-[12px]"
              >
                <div className="flex items-center gap-[10px]">
                  <Avatar name={r.name} colorKey={r.staffId} size={30} />
                  <span className="truncate text-[13.5px] font-semibold text-[#111827]">
                    {r.name}
                  </span>
                </div>
                <span className="truncate text-[13px] text-[#374151]">
                  {r.employeeName}
                </span>
                <span className="text-[12.5px] text-[#6B7280]">
                  {r.period ?? "—"}
                </span>
                <span className="text-right font-archivo text-[13.5px] font-bold tabular-nums text-[#111827]">
                  {r.status === "ready" || r.hours > 0 ? `${r.hours}h` : "—"}
                </span>
                <div className="flex items-center justify-end gap-2">
                  <RowStatus row={r} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="mt-[16px] flex flex-wrap items-center gap-3">
        <form action={pushAllAction}>
          <Button type="submit" disabled={readyCount === 0}>
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
