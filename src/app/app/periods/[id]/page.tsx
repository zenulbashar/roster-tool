import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo } from "@/lib/tenant/repository";
import { generateToken } from "@/lib/tokens";
import {
  enqueueAvailabilityRequest,
  scheduleAvailabilityReminder,
} from "@/lib/jobs/boss";
import { formatDateOnly, formatTimeOnly, zonedDateTimeToUtc } from "@/lib/time";
import { periodStatusLabel } from "@/lib/labels";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const TOKEN_TTL_DAYS = 21;

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

  async function requestAvailability(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const period = await repo.getPeriod(id);
    if (!period) notFound();

    const activeStaff = await repo.listStaff({ activeOnly: true });
    const existing = await repo.listRequests(id);
    const already = new Set(existing.map((r) => r.staffMemberId));

    // Deadline (optional): chosen date at 5pm business-local, stored as UTC.
    const [biz] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const deadlineStr = String(formData.get("deadline") ?? "");
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineStr)
      ? zonedDateTimeToUtc(deadlineStr, "17:00", biz?.timezone)
      : null;

    await repo.updatePeriod(id, {
      status: "collecting",
      availabilityDeadline: deadline,
    });

    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);
    // One reminder ~24h before the deadline (or shortly from now if sooner).
    const reminderAt = deadline
      ? new Date(Math.max(deadline.getTime() - 86_400_000, Date.now() + 60_000))
      : null;

    for (const member of activeStaff) {
      if (already.has(member.id)) continue;
      const { token, tokenHash } = generateToken();
      const req = await repo.createRequest({
        rosterPeriodId: id,
        staffMemberId: member.id,
        tokenHash,
        expiresAt,
      });
      await enqueueAvailabilityRequest({ requestId: req.id, token });
      if (reminderAt) {
        await scheduleAvailabilityReminder(
          { requestId: req.id, token },
          reminderAt,
        );
      }
    }

    revalidatePath(`/app/periods/${id}`);
    redirect(`/app/periods/${id}?sent=1`);
  }

  // Group shifts by day for display.
  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  const notRequested = period.status === "draft";
  const dayBeforeStart = (() => {
    const d = new Date(`${period.startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

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
            <form action={requestAvailability} className="mt-3 space-y-4">
              <p className="text-sm text-[var(--color-muted)]">
                We&rsquo;ll email each of your {staff.length} team members a
                private link to choose their shifts.
              </p>
              <Field
                label="Reply by (optional)"
                hint="We'll send one reminder before this date."
              >
                <TextInput
                  type="date"
                  name="deadline"
                  defaultValue={dayBeforeStart}
                />
              </Field>
              <Button type="submit">
                Send to {staff.length}{" "}
                {staff.length === 1 ? "person" : "people"}
              </Button>
            </form>
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
              Build the roster
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
