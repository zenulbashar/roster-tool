import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { formatDateOnly, formatTimeRange } from "@/lib/time";
import { periodStatusLabel, rosterActionLabel } from "@/lib/labels";
import { Banner, ButtonLink, Card, PageHeader } from "@/components/ui";

export default async function PeriodDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; published?: string }>;
}) {
  const { id } = await params;
  const { sent, published: justPublished } = await searchParams;
  const { businessId } = await requireOwner();
  const repo = createTenantRepo(businessId);

  const period = await repo.getPeriod(id);
  if (!period) notFound();

  const [shifts, staff, requests, published] = await Promise.all([
    repo.listShifts(id),
    repo.listStaff({ activeOnly: true }),
    repo.listRequests(id),
    repo.getPublished(id),
  ]);

  const respondedCount = requests.filter((r) => r.respondedAt).length;
  const staffById = new Map(staff.map((s) => [s.id, s]));

  // Group shifts by day for display.
  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  const notRequested = period.status === "draft";

  return (
    <>
      <PageHeader
        title={period.label}
        subtitle={`${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)} · ${periodStatusLabel(period.status)}`}
      />

      {sent ? (
        <div className="mb-4">
          <Banner tone="success">
            Availability requests are on their way to your team.
          </Banner>
        </div>
      ) : null}

      {justPublished ? (
        <div className="mb-4">
          <Banner tone="success">
            Roster published! Everyone&rsquo;s been emailed their shifts.
          </Banner>
        </div>
      ) : null}

      {published ? (
        <div className="mb-4">
          <Banner tone="info">
            Shareable roster link:{" "}
            <a
              className="underline"
              href={`/r/${published.publicSlug}`}
              target="_blank"
              rel="noreferrer"
            >
              /r/{published.publicSlug}
            </a>
          </Banner>
        </div>
      ) : null}

      {notRequested ? (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold">
            Ask your team for availability
          </h2>
          {shifts.length === 0 ? (
            <p className="mt-1 text-[var(--color-muted)]">
              Add some shift types first, then recreate this roster.
            </p>
          ) : staff.length === 0 ? (
            <p className="mt-1 text-[var(--color-muted)]">
              Add staff before asking for availability.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-[var(--color-muted)]">
                Choose who to email a private availability link — and skip
                anyone you already know about.
              </p>
              <ButtonLink href={`/app/periods/${id}/request`}>
                Choose who to ask →
              </ButtonLink>
            </div>
          )}
        </Card>
      ) : (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold">Availability</h2>
          <p className="mt-1 text-[var(--color-muted)]">
            {respondedCount} of {requests.length} replied so far.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {requests.map((r) => {
              const member = staffById.get(r.staffMemberId);
              return (
                <li key={r.id} className="flex justify-between">
                  <span>{member?.name ?? "Unknown"}</span>
                  <span
                    className={
                      r.respondedAt
                        ? "font-medium text-[var(--color-ok)]"
                        : "text-[var(--color-muted)]"
                    }
                  >
                    {r.respondedAt ? "Replied" : "Waiting"}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <ButtonLink href={`/app/periods/${id}/build`}>
              {rosterActionLabel(period.status)}
            </ButtonLink>
          </div>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">Shifts</h2>
      {shifts.length === 0 ? (
        <Card>
          <p className="text-[var(--color-muted)]">
            This roster has no shifts yet.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([date, dayShifts]) => (
            <Card key={date}>
              <h3 className="text-base font-semibold">
                {formatDateOnly(date)}
              </h3>
              <ul className="mt-2 space-y-1">
                {dayShifts.map((s) => (
                  <li
                    key={s.id}
                    className="flex justify-between text-sm text-[var(--color-muted)]"
                  >
                    <span className="font-medium text-[var(--color-ink)]">
                      {s.label}
                    </span>
                    <span>{formatTimeRange(s.startTime, s.endTime)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
