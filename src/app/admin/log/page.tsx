import Link from "next/link";
import { requireAdmin } from "@/lib/admin/context";
import { createAdminRepo } from "@/lib/admin/repository";
import { Card, Badge } from "@/components/ui";
import { formatDateTime, DEFAULT_TIMEZONE } from "@/lib/time";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function AdminLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const repo = createAdminRepo();
  const [rows, total] = await Promise.all([
    repo.listActivity({ limit: PAGE_SIZE, offset }),
    repo.countActivity(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <header className="mb-[18px]">
        <h1 className="font-archivo text-[25px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
          Admin activity log
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--color-text-secondary)]">
          Who did what, on whose account. Write actions are flagged for
          accountability.
        </p>
      </header>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[#FAFBFC]">
                <Th>Type</Th>
                <Th>Admin</Th>
                <Th>Action</Th>
                <Th>Venue</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-[13.5px] text-[var(--color-text-muted)]"
                  >
                    No admin activity yet.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-[#F3F4F6] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Badge tone={a.isWrite ? "danger" : "draft"}>
                        {a.isWrite ? "Write" : "Read"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-[var(--color-text)]">
                      {a.adminName}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                      <span className="font-semibold text-[var(--color-text)]">
                        {a.action}
                      </span>
                      {a.detail ? <span> — {a.detail}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                      {a.venueName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[12.5px] tabular-nums text-[var(--color-text-muted)]">
                      {formatDateTime(a.createdAt, DEFAULT_TIMEZONE)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-[13px] text-[var(--color-text-secondary)]">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`/admin/log?page=${page - 1}`}
                className="rounded-[8px] border border-[var(--color-border)] bg-white px-[12px] py-[7px] font-semibold text-[#374151] hover:bg-[var(--color-bg)]"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={`/admin/log?page=${page + 1}`}
                className="rounded-[8px] border border-[var(--color-border)] bg-white px-[12px] py-[7px] font-semibold text-[#374151] hover:bg-[var(--color-bg)]"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
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
