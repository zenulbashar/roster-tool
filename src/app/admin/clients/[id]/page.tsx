import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/context";
import {
  createAdminRepo,
  type PlanStatus,
  type ClientLocation,
} from "@/lib/admin/repository";
import { setPlanStatus } from "@/app/admin/actions";
import { Card, SectionCard, Badge, type BadgeTone } from "@/components/ui";
import { formatDate, DEFAULT_TIMEZONE } from "@/lib/time";
import { relativeTime } from "@/lib/notifications";
import { ImpersonationEntryModal } from "@/components/admin/ImpersonationEntryModal";

export const dynamic = "force-dynamic";

const STATUS_META: Record<PlanStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  trial: { label: "Trial", tone: "warning" },
  paused: { label: "Paused", tone: "draft" },
};

const PLAN_OPTIONS: PlanStatus[] = ["active", "trial", "paused"];

export default async function AdminClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const client = await createAdminRepo().getClient(id);
  if (!client) notFound();

  const now = new Date();
  const meta = STATUS_META[client.planStatus];
  const summary = [
    "Standard plan",
    `${client.locations.length} location${client.locations.length === 1 ? "" : "s"}`,
    `${client.staffCount} staff`,
    client.lastActiveAt
      ? `last active ${relativeTime(client.lastActiveAt, now)}`
      : "no activity yet",
  ].join(" · ");

  return (
    <div>
      <Link
        href="/admin/clients"
        className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-[#312E81] hover:underline"
      >
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[18px]"
        >
          arrow_back
        </span>
        All clients
      </Link>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-archivo text-[26px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
              {client.name}
            </h1>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <p className="mt-1.5 text-[13.5px] text-[var(--color-text-secondary)]">
            {summary}
          </p>
        </div>
        <ImpersonationEntryModal
          orgId={client.orgId}
          venueName={client.name}
          variant="primary"
        />
      </header>

      <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
        <SectionCard title="Plan & billing">
          <dl className="space-y-3 text-[13.5px]">
            <Row label="Plan">Standard · $49/mo flat</Row>
            <Row label="Account status">
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </Row>
            <Row label="Customer since">
              {formatDate(client.createdAt, DEFAULT_TIMEZONE)}
            </Row>
          </dl>
          <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            Roster charges a flat monthly fee. Payments and invoicing are
            handled outside the app — this panel tracks the account&rsquo;s
            lifecycle only, not billing.
          </p>
          <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
            <p className="mb-2 text-[12px] font-semibold text-[var(--color-text-secondary)]">
              Set account status
            </p>
            <div className="flex flex-wrap gap-2">
              {PLAN_OPTIONS.map((opt) => {
                const active = opt === client.planStatus;
                return (
                  <form key={opt} action={setPlanStatus}>
                    <input type="hidden" name="orgId" value={client.orgId} />
                    <input type="hidden" name="status" value={opt} />
                    <button
                      type="submit"
                      disabled={active}
                      className={`rounded-[8px] border px-[12px] py-[7px] text-[12.5px] font-semibold capitalize transition-colors ${
                        active
                          ? "cursor-default border-[#312E81] bg-[#312E81] text-white"
                          : "border-[var(--color-border)] bg-white text-[#374151] hover:border-[#312E81] hover:text-[#312E81]"
                      }`}
                    >
                      {STATUS_META[opt].label}
                    </button>
                  </form>
                );
              })}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Integrations">
          <ul className="space-y-3">
            {client.locations.map((loc: ClientLocation) => (
              <li
                key={loc.id}
                className="rounded-[11px] border border-[var(--color-border)] bg-[var(--color-bg)] px-[13px] py-[11px]"
              >
                <p className="font-archivo text-[13.5px] font-bold text-[var(--color-text)]">
                  {loc.name}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <IntegrationStatus
                    label="Xero"
                    connected={loc.hasXero}
                    detail={
                      loc.hasXero
                        ? loc.xeroActive
                          ? (loc.xeroOrgName ?? "Connected")
                          : "Awaiting confirmation"
                        : null
                    }
                    warn={loc.hasXero && !loc.xeroActive}
                  />
                  <IntegrationStatus
                    label="Google Drive"
                    connected={loc.hasDrive}
                    detail={
                      loc.hasDrive
                        ? loc.driveNeedsReconnect
                          ? "Needs reconnect"
                          : (loc.driveEmail ?? "Connected")
                        : null
                    }
                    warn={loc.driveNeedsReconnect}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <Card padded={false} className="mt-4">
        <div className="border-b border-[var(--color-border-subtle)] px-[18px] py-[14px]">
          <h2 className="font-archivo text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-muted)]">
            Recent admin activity on this client
          </h2>
        </div>
        {client.recentActivity.length === 0 ? (
          <p className="px-[18px] py-8 text-center text-[13px] text-[var(--color-text-muted)]">
            No admin activity recorded for this client yet.
          </p>
        ) : (
          <ul>
            {client.recentActivity.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-3 border-b border-[#F3F4F6] px-[18px] py-3 last:border-0"
              >
                <Badge tone={a.isWrite ? "danger" : "draft"}>
                  {a.isWrite ? "Write" : "Read"}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-[var(--color-text)]">
                    {a.action}
                    {a.detail ? (
                      <span className="font-normal text-[var(--color-text-secondary)]">
                        {" "}
                        — {a.detail}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                    {a.adminName} · {relativeTime(a.createdAt, now)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-semibold text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

function IntegrationStatus({
  label,
  connected,
  detail,
  warn = false,
}: {
  label: string;
  connected: boolean;
  detail: string | null;
  warn?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="material-symbols-rounded text-[16px]"
        style={{
          color: warn ? "#B45309" : connected ? "#15803D" : "#9CA3AF",
        }}
      >
        {connected
          ? warn
            ? "error"
            : "check_circle"
          : "remove_circle_outline"}
      </span>
      <span className="font-semibold text-[var(--color-text-secondary)]">
        {label}
      </span>
      {detail ? (
        <span className="text-[var(--color-text-muted)]">· {detail}</span>
      ) : (
        <span className="text-[var(--color-text-muted)]">· Not connected</span>
      )}
    </span>
  );
}
