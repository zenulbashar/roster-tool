import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { findPublishedBySlug } from "@/lib/tenant/public-access";
import { createTenantRepo } from "@/lib/tenant/repository";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PublicRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const published = await findPublishedBySlug(slug);

  if (!published) {
    return (
      <main id="main" className="mx-auto max-w-md px-5 py-16">
        <Card>
          <h1 className="text-xl font-bold">Roster not found</h1>
          <p className="mt-2 text-[var(--color-muted)]">
            This link may be wrong or the roster hasn&rsquo;t been published.
          </p>
        </Card>
      </main>
    );
  }

  const repo = createTenantRepo(published.businessId);
  const [rows, [business]] = await Promise.all([
    repo.rosterRows(published.rosterPeriodId),
    db
      .select({ name: businesses.name })
      .from(businesses)
      .where(eq(businesses.id, published.businessId))
      .limit(1),
  ]);

  // Group rows: day -> shift -> staff names.
  type ShiftGroup = {
    shiftId: string;
    label: string;
    timeText: string;
    names: string[];
  };
  const byDay = new Map<string, Map<string, ShiftGroup>>();
  for (const r of rows) {
    const day = byDay.get(r.date) ?? new Map<string, ShiftGroup>();
    const group = day.get(r.shiftId) ?? {
      shiftId: r.shiftId,
      label: r.label,
      timeText: `${formatTimeOnly(r.startTime)} – ${formatTimeOnly(r.endTime)}`,
      names: [],
    };
    if (r.staffName) group.names.push(r.staffName);
    day.set(r.shiftId, group);
    byDay.set(r.date, day);
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm font-semibold text-[var(--color-brand)]">
        {business?.name}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">
        {published.periodLabel}
      </h1>
      <p className="mt-1 text-[var(--color-muted)]">
        {formatDateOnly(published.startDate)} –{" "}
        {formatDateOnly(published.endDate)}
      </p>

      <div className="mt-6 space-y-4">
        {[...byDay.entries()].map(([date, shiftsForDay]) => (
          <Card key={date}>
            <h2 className="text-base font-semibold">{formatDateOnly(date)}</h2>
            <ul className="mt-2 space-y-2">
              {[...shiftsForDay.values()].map((g) => (
                <li key={g.shiftId}>
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{g.label}</span>
                    <span className="text-sm text-[var(--color-muted)]">
                      {g.timeText}
                    </span>
                  </div>
                  <p className="text-sm">
                    {g.names.length > 0 ? (
                      g.names.join(", ")
                    ) : (
                      <span className="text-[var(--color-muted)]">
                        Nobody assigned
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </main>
  );
}
