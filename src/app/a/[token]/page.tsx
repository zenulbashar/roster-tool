import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { findRequestByToken } from "@/lib/tenant/public-access";
import { createTenantRepo } from "@/lib/tenant/repository";
import { formatDateOnly, formatTimeOnly, formatDateTime } from "@/lib/time";
import { Banner, Button, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { token } = await params;
  const { saved } = await searchParams;

  const request = await findRequestByToken(token);
  if (!request) {
    return (
      <main id="main" className="mx-auto max-w-md px-5 py-16">
        <Card>
          <h1 className="text-xl font-bold">This link isn&rsquo;t working</h1>
          <p className="mt-2 text-[var(--color-muted)]">
            It may have expired or already been used. Please ask your manager to
            send you a new one.
          </p>
        </Card>
      </main>
    );
  }

  const repo = createTenantRepo(request.businessId);
  const [period, shifts, staff, existing, [business]] = await Promise.all([
    repo.getPeriod(request.rosterPeriodId),
    repo.listShifts(request.rosterPeriodId),
    repo.getStaff(request.staffMemberId),
    repo.responsesForRequest(request.id),
    db
      .select({ name: businesses.name, timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, request.businessId))
      .limit(1),
  ]);

  if (!period || !staff || !business) {
    return (
      <main id="main" className="mx-auto max-w-md px-5 py-16">
        <Card>
          <h1 className="text-xl font-bold">This link isn&rsquo;t working</h1>
        </Card>
      </main>
    );
  }

  // Prefill from any prior answers; default to "Available" to minimise taps.
  const priorById = new Map(existing.map((e) => [e.shiftId, e.available]));

  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  async function submit(formData: FormData) {
    "use server";
    // Re-resolve from the token: it, not any form field, is the authority.
    const req = await findRequestByToken(token);
    if (!req) redirect(`/a/${token}`);

    const repo = createTenantRepo(req.businessId);
    const periodShifts = await repo.listShifts(req.rosterPeriodId);
    const entries = periodShifts.map((s) => ({
      shiftId: s.id,
      available: formData.get(`shift_${s.id}`) !== "no",
    }));

    await repo.saveResponses(req.id, entries);
    await repo.markRequestResponded(req.id);
    revalidatePath(`/a/${token}`);
    redirect(`/a/${token}?saved=1`);
  }

  const deadlineText = period.availabilityDeadline
    ? formatDateTime(period.availabilityDeadline, business.timezone)
    : null;

  return (
    <main id="main" className="mx-auto max-w-xl px-5 py-10">
      <p className="text-sm font-semibold text-[var(--color-brand)]">
        {business.name}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">
        Hi {staff.name}, when can you work?
      </h1>
      <p className="mt-2 text-[var(--color-muted)]">
        Roster: <strong>{period.label}</strong>. Tap the shifts you{" "}
        <em>can&rsquo;t</em> do — everything starts as &ldquo;I can work&rdquo;.
        {deadlineText ? ` Please reply by ${deadlineText}.` : ""}
      </p>

      {saved ? (
        <div className="mt-4">
          <Banner tone="success">
            Thanks! Your availability has been saved. You can change it any time
            using this link.
          </Banner>
        </div>
      ) : null}

      <form action={submit} className="mt-6 space-y-4">
        {[...byDay.entries()].map(([date, dayShifts]) => (
          <Card key={date}>
            <h2 className="text-base font-semibold">{formatDateOnly(date)}</h2>
            <ul className="mt-3 space-y-3">
              {dayShifts.map((s) => {
                const prior = priorById.get(s.id);
                const cantSelected = prior === false;
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <span>
                      <span className="font-medium">{s.label}</span>{" "}
                      <span className="text-sm text-[var(--color-muted)]">
                        {formatTimeOnly(s.startTime)} –{" "}
                        {formatTimeOnly(s.endTime)}
                      </span>
                    </span>
                    <span
                      className="inline-flex overflow-hidden rounded-lg border border-[var(--color-line)]"
                      role="group"
                      aria-label={`${s.label} ${formatDateOnly(date)}`}
                    >
                      <label className="cursor-pointer px-3 py-2 text-sm font-medium has-[:checked]:bg-[var(--color-ok)] has-[:checked]:text-white">
                        <input
                          type="radio"
                          name={`shift_${s.id}`}
                          value="yes"
                          defaultChecked={!cantSelected}
                          className="sr-only"
                        />
                        I can work
                      </label>
                      <label className="cursor-pointer border-l border-[var(--color-line)] px-3 py-2 text-sm font-medium has-[:checked]:bg-[var(--color-danger)] has-[:checked]:text-white">
                        <input
                          type="radio"
                          name={`shift_${s.id}`}
                          value="no"
                          defaultChecked={cantSelected}
                          className="sr-only"
                        />
                        Can&rsquo;t
                      </label>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}

        {shifts.length === 0 ? (
          <Card>
            <p className="text-[var(--color-muted)]">
              There are no shifts to choose yet. Please check back later.
            </p>
          </Card>
        ) : (
          <Button type="submit" className="w-full">
            Save my availability
          </Button>
        )}
      </form>
    </main>
  );
}
