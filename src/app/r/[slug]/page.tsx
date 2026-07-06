import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { findPublishedBySlug } from "@/lib/tenant/public-access";
import { createTenantRepo } from "@/lib/tenant/repository";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";
import { shiftColorScheme } from "@/lib/shift-colors";
import { StaffHeader } from "@/components/StaffHeader";

export const dynamic = "force-dynamic";

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function weekdayOf(date: string): string {
  return WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

export default async function PublicRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const published = await findPublishedBySlug(slug);

  if (!published) {
    return (
      <div className="mx-auto mt-10 max-w-[420px] rounded-[16px] border border-[var(--color-border)] bg-white p-7 text-center shadow-[var(--shadow-card)]">
        <h1 className="font-archivo text-[20px] font-extrabold text-[var(--color-ink)]">
          Roster not found
        </h1>
        <p className="mt-2 text-[var(--color-text-secondary)]">
          This link may be wrong or the roster hasn&rsquo;t been published.
        </p>
      </div>
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
      <StaffHeader
        businessName={business?.name ?? ""}
        eyebrow="Published roster"
        title={published.periodLabel}
        subtitle={`${formatDateOnly(published.startDate)} – ${formatDateOnly(published.endDate)}`}
      />

      <div className="space-y-4">
        {[...byDay.entries()].map(([date, shiftsForDay]) => (
          <div
            key={date}
            className="overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-white shadow-[var(--shadow-card)]"
          >
            <div className="flex items-baseline gap-2 border-b border-[var(--color-border-subtle)] bg-[#FAFBFC] px-4 py-3">
              <span className="font-archivo text-[15px] font-bold text-[var(--color-ink)]">
                {weekdayOf(date)}
              </span>
              <span className="text-[12.5px] text-[var(--color-text-muted)]">
                {formatDateOnly(date)}
              </span>
            </div>
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {[...shiftsForDay.values()].map((g) => {
                const scheme = shiftColorScheme(g.label);
                return (
                  <li key={g.shiftId} className="flex gap-3 px-4 py-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-[10px] w-[10px] flex-shrink-0 rounded-full"
                      style={{ backgroundColor: scheme.bar }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span
                          className="font-archivo text-[14px] font-bold"
                          style={{ color: scheme.text }}
                        >
                          {g.label}
                        </span>
                        <span className="text-[12.5px] text-[var(--color-text-secondary)]">
                          {g.timeText}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[13.5px] text-[var(--color-ink)]">
                        {g.names.length > 0 ? (
                          g.names.join(", ")
                        ) : (
                          <span className="text-[var(--color-text-muted)]">
                            Nobody assigned
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-[12px] text-[var(--color-text-muted)]">
        Roster by ROSTER · roster.zaleit.com.au
      </p>
    </main>
  );
}
