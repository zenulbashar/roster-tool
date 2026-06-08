import Link from "next/link";
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
import { formatDateOnly, zonedDateTimeToUtc } from "@/lib/time";
import {
  Banner,
  Button,
  Card,
  Field,
  PageHeader,
  TextInput,
} from "@/components/ui";

const TOKEN_TTL_DAYS = 21;

export default async function ChooseRecipientsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { businessId } = await requireOwner();
  const repo = createTenantRepo(businessId);

  const period = await repo.getPeriod(id);
  if (!period) notFound();

  const [staff, shifts, requests, responses] = await Promise.all([
    repo.listStaff({ activeOnly: true }),
    repo.listShifts(id),
    repo.listRequests(id),
    repo.listResponses(id),
  ]);

  const alreadyAsked = new Set(requests.map((r) => r.staffMemberId));
  const prefilled = new Set(
    responses.filter((r) => r.source === "manual").map((r) => r.staffMemberId),
  );

  const dayBeforeStart = (() => {
    const d = new Date(`${period.startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  async function sendRequests(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const period = await repo.getPeriod(id);
    if (!period) notFound();

    // Only ids that are genuinely this business's active staff are honoured —
    // never trust the posted list blindly.
    const activeStaff = await repo.listStaff({ activeOnly: true });
    const activeIds = new Set(activeStaff.map((s) => s.id));
    const existing = await repo.listRequests(id);
    const alreadyAsked = new Set(existing.map((r) => r.staffMemberId));
    const responses = await repo.listResponses(id);
    const prefilled = new Set(
      responses
        .filter((r) => r.source === "manual")
        .map((r) => r.staffMemberId),
    );

    const selected = formData
      .getAll("staffIds")
      .map(String)
      .filter(
        (sid) =>
          activeIds.has(sid) && !alreadyAsked.has(sid) && !prefilled.has(sid),
      );

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
    const reminderAt = deadline
      ? new Date(Math.max(deadline.getTime() - 86_400_000, Date.now() + 60_000))
      : null;

    for (const staffMemberId of new Set(selected)) {
      const { token, tokenHash } = generateToken();
      const req = await repo.createRequest({
        rosterPeriodId: id,
        staffMemberId,
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

  async function markAvailable(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const period = await repo.getPeriod(id);
    if (!period) notFound();

    const staffId = String(formData.get("staffId"));
    await repo.markAvailableManually(staffId, id);

    if (period.status === "draft") {
      await repo.updatePeriod(id, { status: "collecting" });
    }
    revalidatePath(`/app/periods/${id}/request`);
  }

  return (
    <>
      <PageHeader
        title="Who should we ask?"
        subtitle={`${period.label} · ${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}`}
      />

      {shifts.length === 0 ? (
        <Banner tone="warn">
          This roster has no shifts yet. Add shift types and recreate the roster
          first.
        </Banner>
      ) : staff.length === 0 ? (
        <Banner tone="warn">Add staff before asking for availability.</Banner>
      ) : (
        <>
          <Card>
            <p className="text-sm text-[var(--color-muted)]">
              Tick the people you want to email a private availability link.
              People who are off by default are unticked — tick them to include
              them this time. If you already know someone is free, use{" "}
              <strong>Mark all shifts available</strong> instead of emailing
              them.
            </p>

            <ul className="mt-4 space-y-3">
              {staff.map((s) => {
                const asked = alreadyAsked.has(s.id);
                const isPrefilled = prefilled.has(s.id);
                const locked = asked || isPrefilled;
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-3 last:border-0 last:pb-0"
                  >
                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        name="staffIds"
                        value={s.id}
                        form="send-form"
                        defaultChecked={s.notifyByDefault && !locked}
                        disabled={locked}
                        className="h-5 w-5 rounded border-[var(--color-line)] accent-[var(--color-brand)]"
                      />
                      <span>
                        <span className="font-medium">{s.name}</span>{" "}
                        <span className="text-sm text-[var(--color-muted)]">
                          {s.email}
                        </span>
                      </span>
                    </label>

                    {isPrefilled ? (
                      <span className="rounded bg-[var(--color-ok)] px-2 py-0.5 text-xs font-medium text-white">
                        Marked available
                      </span>
                    ) : asked ? (
                      <span className="rounded bg-[var(--color-canvas)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
                        Already asked
                      </span>
                    ) : (
                      <form action={markAvailable}>
                        <input type="hidden" name="staffId" value={s.id} />
                        <button
                          type="submit"
                          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
                        >
                          Mark all shifts available
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="mt-4">
            <form id="send-form" action={sendRequests} className="space-y-4">
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
              <Button type="submit">Send to the ticked people</Button>
            </form>
          </Card>
        </>
      )}

      <div className="mt-6">
        <Link
          href={`/app/periods/${id}`}
          className="text-sm font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          ← Back to roster
        </Link>
      </div>
    </>
  );
}
