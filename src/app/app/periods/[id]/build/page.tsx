import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { generateSlug } from "@/lib/tokens";
import { enqueuePublishedRoster } from "@/lib/jobs/boss";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";
import { periodStatusLabel } from "@/lib/labels";
import { Banner, Button, Card, PageHeader } from "@/components/ui";

type Availability = "yes" | "no" | "unknown";

export default async function BuildRosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { businessId } = await requireOwner();
  const repo = createTenantRepo(businessId);

  const period = await repo.getPeriod(id);
  if (!period) notFound();

  const [shifts, staff, responses, assignments, requests, published] =
    await Promise.all([
      repo.listShifts(id),
      repo.listStaff({ activeOnly: true }),
      repo.listResponses(id),
      repo.listAssignments(id),
      repo.listRequests(id),
      repo.getPublished(id),
    ]);

  // Move the period into "building" the first time the owner opens the builder.
  if (period.status === "collecting") {
    await repo.updatePeriod(id, { status: "building" });
  }

  // availability[shiftId][staffId] = yes | no
  const avail = new Map<string, Map<string, boolean>>();
  // Set of `${shiftId}:${staffId}` that were pre-filled by the owner (manual),
  // not answered by the staff member themselves.
  const prefilled = new Set<string>();
  for (const r of responses) {
    const m = avail.get(r.shiftId) ?? new Map<string, boolean>();
    m.set(r.staffMemberId, r.available);
    avail.set(r.shiftId, m);
    if (r.source === "manual") prefilled.add(`${r.shiftId}:${r.staffMemberId}`);
  }
  // assigned[shiftId] = Set(staffId)
  const assigned = new Map<string, Set<string>>();
  for (const a of assignments) {
    const s = assigned.get(a.shiftId) ?? new Set<string>();
    s.add(a.staffMemberId);
    assigned.set(a.shiftId, s);
  }
  const respondedStaff = new Set(
    requests.filter((r) => r.respondedAt).map((r) => r.staffMemberId),
  );

  function availabilityOf(shiftId: string, staffId: string): Availability {
    const m = avail.get(shiftId);
    if (m?.has(staffId)) return m.get(staffId) ? "yes" : "no";
    return respondedStaff.has(staffId) ? "yes" : "unknown";
  }

  async function toggleAssign(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const shiftId = String(formData.get("shiftId"));
    const staffId = String(formData.get("staffId"));
    const isAssigned = formData.get("assigned") === "true";

    // Validate both belong to this business before mutating.
    const [shift, member] = await Promise.all([
      repo.getShift(shiftId),
      repo.getStaff(staffId),
    ]);
    if (!shift || shift.rosterPeriodId !== id || !member) return;

    if (isAssigned) await repo.unassign(shiftId, staffId);
    else await repo.assign(shiftId, staffId);

    revalidatePath(`/app/periods/${id}/build`);
  }

  async function publish() {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const period = await repo.getPeriod(id);
    if (!period) notFound();

    // Reuse the existing slug on re-publish so shared links keep working.
    const existing = await repo.getPublished(id);
    await repo.publish(id, existing?.publicSlug ?? generateSlug());
    await repo.updatePeriod(id, { status: "published" });

    // Email everyone who was asked (or all active staff if none were asked).
    const reqs = await repo.listRequests(id);
    const targets = reqs.length
      ? reqs.map((r) => r.staffMemberId)
      : (await repo.listStaff({ activeOnly: true })).map((s) => s.id);
    for (const staffMemberId of new Set(targets)) {
      await enqueuePublishedRoster({ rosterPeriodId: id, staffMemberId });
    }

    redirect(`/app/periods/${id}?published=1`);
  }

  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  const respondedCount = requests.filter((r) => r.respondedAt).length;

  return (
    <>
      <PageHeader
        title={`Build: ${period.label}`}
        subtitle={`${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)} · ${periodStatusLabel(period.status)}`}
      />

      <p className="mb-4 text-sm text-[var(--color-muted)]">
        {respondedCount} of {requests.length} replied. Tap a name to put them on
        a shift. <span className="text-[var(--color-ok)]">Green</span> = free,{" "}
        <span className="text-[var(--color-danger)]">red</span> = can&rsquo;t,
        grey = no reply yet.
      </p>

      <div className="space-y-4">
        {[...byDay.entries()].map(([date, dayShifts]) => (
          <Card key={date}>
            <h2 className="text-base font-semibold">{formatDateOnly(date)}</h2>
            <ul className="mt-3 space-y-4">
              {dayShifts.map((s) => {
                const assignedSet = assigned.get(s.id) ?? new Set<string>();
                // Show free + already-assigned + no-reply first; can'ts last.
                const ordered = [...staff].sort((a, b) => {
                  const rank = (st: string) =>
                    availabilityOf(s.id, st) === "no" ? 1 : 0;
                  return rank(a.id) - rank(b.id);
                });
                return (
                  <li key={s.id}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-sm text-[var(--color-muted)]">
                        {formatTimeOnly(s.startTime)} –{" "}
                        {formatTimeOnly(s.endTime)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ordered.map((member) => {
                        const isAssigned = assignedSet.has(member.id);
                        const a = availabilityOf(s.id, member.id);
                        const isPrefilled = prefilled.has(
                          `${s.id}:${member.id}`,
                        );
                        const marker =
                          a === "yes" ? "✓" : a === "no" ? "✗" : "?";
                        const tone = isAssigned
                          ? "bg-[var(--color-brand)] text-white border-[var(--color-brand)]"
                          : a === "yes"
                            ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                            : a === "no"
                              ? "border-[var(--color-danger)] text-[var(--color-danger)]"
                              : "border-[var(--color-line)] text-[var(--color-muted)]";
                        return (
                          <form key={member.id} action={toggleAssign}>
                            <input type="hidden" name="shiftId" value={s.id} />
                            <input
                              type="hidden"
                              name="staffId"
                              value={member.id}
                            />
                            <input
                              type="hidden"
                              name="assigned"
                              value={String(isAssigned)}
                            />
                            <button
                              type="submit"
                              aria-pressed={isAssigned}
                              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${tone}`}
                            >
                              {member.name}{" "}
                              <span aria-hidden="true">{marker}</span>
                              {isPrefilled && !isAssigned ? (
                                <span className="ml-1 rounded bg-[var(--color-ok)] px-1 py-0.5 text-[10px] font-semibold text-white">
                                  Pre-filled
                                </span>
                              ) : null}
                            </button>
                          </form>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Publish &amp; send</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          We&rsquo;ll email everyone their shifts and create a shareable roster
          link.
        </p>
        {published ? (
          <div className="mt-3">
            <Banner tone="success">
              Published. Shareable link:{" "}
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
        <form action={publish} className="mt-3">
          <Button type="submit">
            {published ? "Re-publish & resend" : "Publish roster"}
          </Button>
        </form>
      </Card>

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
