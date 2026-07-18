import Link from "next/link";
import { requireAdmin } from "@/lib/admin/context";
import {
  createAdminRepo,
  type PlanStatus,
  type AdminClientRow,
} from "@/lib/admin/repository";
import { KpiTile, Badge, Card, type BadgeTone } from "@/components/ui";
import { ImpersonationEntryModal } from "@/components/admin/ImpersonationEntryModal";
import { relativeTime } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const STATUS_META: Record<PlanStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  trial: { label: "Trial", tone: "warning" },
  paused: { label: "Paused", tone: "draft" },
};

const FILTERS: Array<{ key: "all" | PlanStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trial", label: "Trial" },
  { key: "paused", label: "Paused" },
];

function IntegrationChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg)] px-[7px] py-[2px] text-[11px] font-semibold text-[#374151]">
      {label}
    </span>
  );
}

export default async function AdminClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const status: "all" | PlanStatus =
    sp.status === "active" || sp.status === "trial" || sp.status === "paused"
      ? sp.status
      : "all";
  const search = sp.q?.trim() ?? "";

  const repo = createAdminRepo();
  const [stats, clients] = await Promise.all([
    repo.getClientStats(),
    repo.listClients({
      status: status === "all" ? undefined : status,
      search: search || undefined,
    }),
  ]);

  const now = new Date();
  const qs = (next: { status?: string; q?: string }) => {
    const params = new URLSearchParams();
    const s = next.status ?? (status === "all" ? undefined : status);
    const q = next.q ?? (search || undefined);
    if (s) params.set("status", s);
    if (q) params.set("q", q);
    const str = params.toString();
    return str ? `?${str}` : "";
  };

  return (
    <div>
      <header className="mb-[18px]">
        <h1 className="font-archivo text-[25px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
          Client businesses
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--color-text-secondary)]">
          Open a client, or view as their venue to support them.
        </p>
      </header>

      <div className="mb-5 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
        <KpiTile
          label="Clients"
          value={stats.total}
          icon="storefront"
          valueColor="#312E81"
        />
        <KpiTile
          label="Active"
          value={stats.active}
          icon="check_circle"
          valueColor="#312E81"
        />
        <KpiTile
          label="On trial"
          value={stats.trial}
          icon="schedule"
          valueColor="#312E81"
        />
        <KpiTile
          label="Staff on platform"
          value={stats.totalStaff}
          icon="group"
          valueColor="#312E81"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form method="get" className="flex items-center">
          {status !== "all" ? (
            <input type="hidden" name="status" value={status} />
          ) : null}
          <div className="flex items-center gap-2 rounded-[11px] border border-[var(--color-border)] bg-white px-[13px] py-[9px]">
            <span
              aria-hidden="true"
              className="material-symbols-rounded text-[19px] text-[var(--color-text-muted)]"
            >
              search
            </span>
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search clients"
              aria-label="Search clients"
              className="w-[180px] border-none bg-transparent text-[14px] outline-none placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const active = f.key === status;
            return (
              <Link
                key={f.key}
                href={`/admin/clients${qs({
                  status: f.key === "all" ? "" : f.key,
                })}`}
                className={`rounded-[8px] border px-[12px] py-[7px] text-[12.5px] font-semibold transition-colors ${
                  active
                    ? "border-[#312E81] bg-[#312E81] text-white"
                    : "border-[var(--color-border)] bg-white text-[#374151] hover:border-[#312E81] hover:text-[#312E81]"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[#FAFBFC]">
                <Th>Business</Th>
                <Th>Plan</Th>
                <Th className="text-right">Sites</Th>
                <Th className="text-right">Staff</Th>
                <Th>Integrations</Th>
                <Th>Last active</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-[13.5px] text-[var(--color-text-muted)]"
                  >
                    No clients match this filter.
                  </td>
                </tr>
              ) : (
                clients.map((c: AdminClientRow) => {
                  const meta = STATUS_META[c.planStatus];
                  return (
                    <tr
                      key={c.orgId}
                      className="border-b border-[#F3F4F6] last:border-0 hover:bg-[#FCFDFC]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/clients/${c.orgId}`}
                          className="flex items-center gap-2.5"
                        >
                          <span className="font-archivo text-[14.5px] font-bold text-[var(--color-text)] hover:underline">
                            {c.name}
                          </span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                        Standard
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[var(--color-text-secondary)]">
                        {c.siteCount}
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] tabular-nums text-[var(--color-text-secondary)]">
                        {c.staffCount}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {c.hasXero ? <IntegrationChip label="Xero" /> : null}
                          {c.hasDrive ? (
                            <IntegrationChip label="Drive" />
                          ) : null}
                          {!c.hasXero && !c.hasDrive ? (
                            <span className="text-[13px] text-[var(--color-text-muted)]">
                              —
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                        {c.lastActiveAt
                          ? relativeTime(c.lastActiveAt, now)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end">
                          <ImpersonationEntryModal
                            orgId={c.orgId}
                            venueName={c.name}
                            variant="row"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`font-archivo px-4 py-[11px] text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#9CA3AF] ${className}`}
    >
      {children}
    </th>
  );
}
