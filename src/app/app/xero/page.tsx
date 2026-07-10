import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { redirect } from "next/navigation";
import { xeroClient } from "@/lib/xero/client";
import type { XeroEarningsRate, XeroEmployee } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import {
  XeroPayrollAdminRequired,
  XeroReconnectRequired,
} from "@/lib/xero/errors";
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
import { saveMappingAction, removeMappingAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function XeroMappingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const owner = await requireOwner();
  const repo = createTenantRepo(owner.businessId);
  const business = await repo.getBusiness();
  if (!business) redirect("/onboarding");

  const connection = await repo.getXeroConnection();

  // --- Connection-state gates -------------------------------------------
  if (!connection) {
    return (
      <Gate
        title="Connect Xero first"
        body="Link your Xero organisation in Settings, then come back to map your staff to Xero employees."
      />
    );
  }
  if (connection.status === "pending_confirmation") {
    return (
      <Gate
        title="Confirm your Xero organisation"
        body="Your Xero connection is waiting for you to confirm the organisation name in Settings before you can map staff."
      />
    );
  }
  if (connection.needsReconnect) {
    return (
      <Gate
        title="Reconnect Xero"
        body="Your Xero access expired or was revoked. Reconnect in Settings to map staff and push hours."
      />
    );
  }

  // --- Load the Xero directory (live) -----------------------------------
  let employees: XeroEmployee[] = [];
  let rates: XeroEarningsRate[] = [];
  let loadError: string | null = null;
  try {
    const accessToken = await ensureFreshXeroAccessToken({
      repo,
      client: xeroClient,
      connection,
    });
    [employees, rates] = await Promise.all([
      xeroClient.listEmployees(accessToken, connection.xeroTenantId),
      xeroClient.listEarningsRates(accessToken, connection.xeroTenantId),
    ]);
  } catch (err) {
    if (err instanceof XeroReconnectRequired) {
      return (
        <Gate
          title="Reconnect Xero"
          body="Your Xero access expired or was revoked. Reconnect in Settings to continue."
        />
      );
    }
    if (err instanceof XeroPayrollAdminRequired) {
      loadError = err.message;
    } else {
      logger.error({ err }, "Xero directory load failed");
      loadError = "Couldn’t load employees from Xero. Please try again.";
    }
  }

  const staff = await repo.listStaff({ activeOnly: true });
  const maps = await repo.listXeroEmployeeMaps();
  const mapByStaff = new Map(maps.map((m) => [m.staffMemberId, m]));
  const rateName = (id: string | null) =>
    id
      ? (rates.find((r) => r.earningsRateId === id)?.name ?? "Selected rate")
      : null;

  return (
    <>
      <PageHeader
        title="Map staff to Xero"
        subtitle={`Connected to ${connection.orgName}. Match each person to their Xero employee; their ordinary earnings rate is where pushed hours land.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/app/xero/rules" variant="secondary">
              Pay rules
            </ButtonLink>
            <ButtonLink href="/app/timesheets" variant="secondary">
              Go to Timesheets to push
            </ButtonLink>
          </div>
        }
      />

      {sp.saved ? <Banner tone="success">Mapping saved.</Banner> : null}
      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {loadError ? <Banner tone="warn">{loadError}</Banner> : null}

      <Banner tone="info">
        Every mapped person’s hours push under their{" "}
        <strong>ordinary earnings rate</strong>, except hours your own{" "}
        <strong>pay rules</strong> move onto another of your Xero pay items —
        Roster sets no rates itself. Review each timesheet in Xero.
      </Banner>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[1.4fr_1.4fr_1.4fr_auto] gap-3 border-b border-[#F1F3F5] bg-[#FAFBFC] px-[18px] py-[11px] text-[11px] font-bold uppercase tracking-[.06em] text-[#6B7280]">
              <span>Staff member</span>
              <span>Xero employee</span>
              <span>Earnings rate</span>
              <span className="text-right">Status</span>
            </div>
            {staff.length === 0 ? (
              <div className="px-[18px] py-[22px] text-[13px] text-[#6B7280]">
                No active staff to map yet.
              </div>
            ) : (
              staff.map((s) => {
                const m = mapByStaff.get(s.id);
                const mapped = Boolean(m);
                const hasRate = Boolean(m?.earningsRateId);
                return (
                  <form
                    key={s.id}
                    action={saveMappingAction}
                    className="grid grid-cols-[1.4fr_1.4fr_1.4fr_auto] items-center gap-3 border-b border-[#F5F6F7] px-[18px] py-[12px]"
                  >
                    <input type="hidden" name="staffMemberId" value={s.id} />
                    <div className="flex items-center gap-[10px]">
                      <Avatar name={s.name} colorKey={s.id} size={30} />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-semibold text-[#111827]">
                          {s.name}
                        </div>
                        <div className="truncate text-[11.5px] text-[#9CA3AF]">
                          {s.email}
                        </div>
                      </div>
                    </div>

                    <select
                      name="xeroEmployeeId"
                      defaultValue={m?.xeroEmployeeId ?? ""}
                      disabled={employees.length === 0}
                      className="w-full rounded-[8px] border border-[#E5E7EB] bg-white px-[10px] py-[8px] text-[12.5px] text-[#374151] outline-none focus:border-[var(--color-button)]"
                    >
                      <option value="">— Not mapped —</option>
                      {employees.map((e) => (
                        <option key={e.employeeId} value={e.employeeId}>
                          {`${e.firstName} ${e.lastName}`.trim()}
                        </option>
                      ))}
                    </select>

                    <select
                      name="earningsRateId"
                      defaultValue={m?.earningsRateId ?? ""}
                      className="w-full rounded-[8px] border border-[#E5E7EB] bg-white px-[10px] py-[8px] text-[12.5px] text-[#374151] outline-none focus:border-[var(--color-button)]"
                    >
                      <option value="">Auto (from pay template)</option>
                      {rates.map((r) => (
                        <option key={r.earningsRateId} value={r.earningsRateId}>
                          {r.name}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center justify-end gap-2">
                      {mapped ? (
                        hasRate ? (
                          <span
                            className="hidden text-[11.5px] text-[#6B7280] sm:inline"
                            title={rateName(m!.earningsRateId) ?? undefined}
                          >
                            {rateName(m!.earningsRateId)}
                          </span>
                        ) : (
                          <Badge tone="warning">No rate</Badge>
                        )
                      ) : null}
                      <Button type="submit" variant="secondary">
                        {mapped ? "Update" : "Map"}
                      </Button>
                    </div>
                  </form>
                );
              })
            )}
          </div>
        </div>
      </Card>

      {maps.length > 0 ? (
        <div className="mt-[14px] flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-[#9CA3AF]">
            Remove a mapping to exclude that person from pushes:
          </span>
          {maps.map((m) => {
            const s = staff.find((x) => x.id === m.staffMemberId);
            return (
              <form key={m.id} action={removeMappingAction}>
                <input
                  type="hidden"
                  name="staffMemberId"
                  value={m.staffMemberId}
                />
                <button
                  type="submit"
                  className="rounded-[7px] border border-[#E5E7EB] bg-white px-[10px] py-[6px] text-[11.5px] font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
                >
                  Unmap {s?.name ?? m.xeroEmployeeName}
                </button>
              </form>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/** A simple connect/confirm/reconnect gate card that points back to Settings. */
function Gate({ title, body }: { title: string; body: string }) {
  return (
    <>
      <PageHeader title="Map staff to Xero" />
      <Card>
        <div className="py-[10px] text-center">
          <h2 className="font-archivo text-[17px] font-bold text-[#111827]">
            {title}
          </h2>
          <p className="mx-auto mt-[8px] max-w-[420px] text-[13px] leading-[1.6] text-[#6B7280]">
            {body}
          </p>
          <div className="mt-[16px]">
            <ButtonLink href="/app/settings">Go to Settings</ButtonLink>
          </div>
        </div>
      </Card>
    </>
  );
}
