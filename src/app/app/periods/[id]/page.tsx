import { notFound } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";
import { periodStatusLabel } from "@/lib/labels";
import { Card, PageHeader } from "@/components/ui";

export default async function PeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repo = await ownerRepo();
  const period = await repo.getPeriod(id);
  if (!period) notFound();

  const shifts = await repo.listShifts(id);

  // Group shifts by day for display.
  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  return (
    <>
      <PageHeader
        title={period.label}
        subtitle={`${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)} · ${periodStatusLabel(period.status)}`}
      />

      {shifts.length === 0 ? (
        <Card>
          <p className="text-[var(--color-muted)]">
            This roster has no shifts. Add some shift types under{" "}
            <strong>Shift types</strong>, then create the roster again.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([date, dayShifts]) => (
            <Card key={date}>
              <h2 className="text-base font-semibold">
                {formatDateOnly(date)}
              </h2>
              <ul className="mt-2 space-y-1">
                {dayShifts.map((s) => (
                  <li
                    key={s.id}
                    className="flex justify-between text-sm text-[var(--color-muted)]"
                  >
                    <span className="font-medium text-[var(--color-ink)]">
                      {s.label}
                    </span>
                    <span>
                      {formatTimeOnly(s.startTime)} –{" "}
                      {formatTimeOnly(s.endTime)}
                    </span>
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
