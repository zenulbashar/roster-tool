import { ownerContext } from "@/lib/auth/context";
import { describeActor, describeEvent } from "@/lib/audit/describe";
import { formatDateTime, DEFAULT_TIMEZONE } from "@/lib/time";
import { Badge, Banner, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Recent changes (OPS-04): the owner's view of their own audit trail — every
 * write made through the owner app at this location (plus org-level changes
 * such as locations, people and loans), who made it, and when. Writes made by
 * a Zale IT admin while acting as the venue are labelled. Reached from
 * Settings → Account; not in the nav.
 */
export default async function ActivityPage() {
  const { repo, org } = await ownerContext();
  const business = await repo.getBusiness();
  const tz = business?.timezone ?? DEFAULT_TIMEZONE;
  const [local, orgLevel, chain] = await Promise.all([
    repo.listAuditEvents({ limit: 100 }),
    org.listAuditEvents({ limit: 50 }),
    repo.getAuditChainStatus(),
  ]);
  const events = [...local, ...orgLevel]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100);

  return (
    <>
      <PageHeader
        title="Recent changes"
        subtitle="Who changed what in your account, and when. Edits to timesheets, staff, settings and rosters are recorded automatically."
      />

      <div className="mb-4">
        {chain.ok ? (
          <Banner tone="success">
            Trail verified: {chain.checked} recorded change
            {chain.checked === 1 ? "" : "s"}, none altered since they were
            written.
          </Banner>
        ) : (
          <Banner tone="error">
            The change record has been altered after the fact (first break at
            entry #{chain.brokenAtSeq}). Contact support — this should never
            happen.
          </Banner>
        )}
      </div>

      <Card padded={false}>
        {events.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
            No changes recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)]">
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>What</Th>
                  <Th>Record</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-b border-[#F3F4F6] last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-[12.5px] tabular-nums text-[var(--color-text-muted)]">
                      {formatDateTime(ev.createdAt, tz)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-text)]">
                      {describeActor(ev)}
                      {ev.impersonatorUserId ? (
                        <span className="ml-2 align-middle">
                          <Badge tone="danger">Support</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-text)]">
                      {describeEvent(ev)}
                      {ev.businessId === null ? (
                        <span className="ml-2 align-middle">
                          <Badge tone="info">All locations</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-[var(--color-text-muted)]">
                      {ev.entityId ? ev.entityId.slice(0, 8) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-archivo px-4 py-[11px] text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#9CA3AF]">
      {children}
    </th>
  );
}
