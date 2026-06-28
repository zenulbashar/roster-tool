import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { generateSlug } from "@/lib/tokens";
import { enqueuePublishedRoster } from "@/lib/jobs/boss";
import { notifyStaff } from "@/lib/staff-notifications";
import { buildDraft, draftSummary } from "@/lib/draft";
import { makeOnLeaveLookup } from "@/lib/leave";
import { formatDateOnly, formatTimeOnly } from "@/lib/time";
import { periodStatusLabel, rosterBuildVerb } from "@/lib/labels";
import { Badge, Banner, Button, Card, PageHeader } from "@/components/ui";
import { shiftColorScheme } from "@/lib/shift-colors";

type Availability = "yes" | "no" | "unknown";

export default async function BuildRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    drafted?: string;
    sg?: string;
    tot?: string;
    un?: string;
  }>;
}) {
  const { id } = await params;
  const { drafted, sg, tot, un } = await searchParams;
  const { businessId } = await requireOwner();
  const repo = createTenantRepo(businessId);

  const period = await repo.getPeriod(id);
  if (!period) notFound();

  const [
    shifts,
    staff,
    responses,
    assignments,
    requests,
    published,
    leave,
    activeOffers,
  ] = await Promise.all([
    repo.listShifts(id),
    repo.listStaff({ activeOnly: true }),
    repo.listResponses(id),
    repo.listAssignments(id),
    repo.listRequests(id),
    repo.getPublished(id),
    repo.listApprovedLeaveBetween(period.startDate, period.endDate),
    repo.listActiveOffersForPeriod(id),
  ]);

  // Is this staff member on approved leave on a given day? Used to flag (not
  // block) on-leave staff in the picker.
  const onLeave = makeOnLeaveLookup(leave);

  // Active shift offers by shift, so the owner sees an "Offered"/"Claimed"
  // marker for shifts mid-swap. The handover only happens on the Shifts page.
  const offerByShift = new Map<
    string,
    { status: string; claimedByName: string | null }
  >();
  for (const o of activeOffers) {
    offerByShift.set(o.shiftId, {
      status: o.status,
      claimedByName: o.claimedByName,
    });
  }

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
  // confirmed[shiftId] / suggested[shiftId] = Set(staffId)
  const confirmed = new Map<string, Set<string>>();
  const suggested = new Map<string, Set<string>>();
  for (const a of assignments) {
    const target = a.status === "suggested" ? suggested : confirmed;
    const s = target.get(a.shiftId) ?? new Set<string>();
    s.add(a.staffMemberId);
    target.set(a.shiftId, s);
  }
  const hasSuggestions = assignments.some((a) => a.status === "suggested");
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

  async function draftFromLastWeek() {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const period = await repo.getPeriod(id);
    if (!period) notFound();

    const last = await repo.getLastPublishedPeriod(id);
    if (!last) {
      redirect(`/app/periods/${id}/build?drafted=none`);
    }

    const [currentShifts, lastAssignments, responses, leave] =
      await Promise.all([
        repo.listShifts(id),
        repo.assignmentsWithShiftType(last.id),
        repo.listResponses(id),
        repo.listApprovedLeaveBetween(period.startDate, period.endDate),
      ]);

    // Available = an explicit "yes" response (staff reply or manual pre-fill).
    const availSet = new Set(
      responses
        .filter((r) => r.available)
        .map((r) => `${r.shiftId}:${r.staffMemberId}`),
    );

    // Don't suggest anyone on approved leave on the shift's day.
    const onLeave = makeOnLeaveLookup(leave);
    const shiftDate = new Map(currentShifts.map((s) => [s.id, s.date]));

    const { suggestions, counts } = buildDraft({
      currentShifts,
      lastAssignments,
      isAvailable: (shiftId, staffId) => availSet.has(`${shiftId}:${staffId}`),
      isOnLeave: (shiftId, staffId) => {
        const date = shiftDate.get(shiftId);
        return date ? onLeave(staffId, date) : false;
      },
    });

    await repo.createSuggestedAssignments(suggestions);

    redirect(
      `/app/periods/${id}/build?drafted=1&sg=${counts.suggestedShifts}&tot=${counts.totalShifts}&un=${counts.blankDueToUnavailable}`,
    );
  }

  async function acceptSuggestion(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const shiftId = String(formData.get("shiftId"));
    const staffId = String(formData.get("staffId"));
    const shift = await repo.getShift(shiftId);
    if (!shift || shift.rosterPeriodId !== id) return;
    await repo.acceptSuggestion(shiftId, staffId);
    revalidatePath(`/app/periods/${id}/build`);
  }

  async function clearSuggestion(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const shiftId = String(formData.get("shiftId"));
    const staffId = String(formData.get("staffId"));
    const shift = await repo.getShift(shiftId);
    if (!shift || shift.rosterPeriodId !== id) return;
    await repo.clearSuggestion(shiftId, staffId);
    revalidatePath(`/app/periods/${id}/build`);
  }

  async function acceptAllSuggestions() {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    await repo.acceptAllSuggestions(id);
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

    // Email everyone who was asked or who ended up on a (confirmed) shift —
    // including people the owner pre-filled, who never got a request. Fall back
    // to all active staff only when there's nothing to go on.
    const [reqs, assignmentsNow] = await Promise.all([
      repo.listRequests(id),
      repo.listAssignments(id),
    ]);
    const asked = reqs.map((r) => r.staffMemberId);
    const assignedStaff = assignmentsNow
      .filter((a) => a.status === "confirmed")
      .map((a) => a.staffMemberId);
    const targets =
      asked.length || assignedStaff.length
        ? [...asked, ...assignedStaff]
        : (await repo.listStaff({ activeOnly: true })).map((s) => s.id);
    for (const staffMemberId of new Set(targets)) {
      await enqueuePublishedRoster({ rosterPeriodId: id, staffMemberId });
    }

    // In-app notice for everyone with a confirmed shift, in addition to the
    // roster email above. One per affected staff member per publish.
    for (const staffMemberId of new Set(assignedStaff)) {
      await notifyStaff(repo, {
        staffMemberId,
        type: "rostered",
        title: "You've been rostered",
        body: `${period.label} — week of ${formatDateOnly(period.startDate)}. Your shifts are in your email.`,
      });
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

  const canDraft = period.status !== "draft";
  const draftedSummary =
    drafted === "1" && tot
      ? draftSummary({
          totalShifts: Number(tot),
          suggestedShifts: Number(sg ?? 0),
          blankShifts: Number(tot) - Number(sg ?? 0),
          blankDueToUnavailable: Number(un ?? 0),
        })
      : null;

  return (
    <>
      <PageHeader
        title={`${rosterBuildVerb(period.status)}: ${period.label}`}
        subtitle={`${formatDateOnly(period.startDate)} – ${formatDateOnly(period.endDate)}`}
        action={
          <Badge tone={period.status === "published" ? "success" : "draft"}>
            {periodStatusLabel(period.status)}
          </Badge>
        }
      />

      <p className="mb-4 text-sm text-[var(--color-muted)]">
        {respondedCount} of {requests.length} replied. Tap a name to put them on
        a shift. <span className="text-[var(--color-ok)]">Green</span> = free,{" "}
        <span className="text-[var(--color-danger)]">red</span> = can&rsquo;t,
        grey = no reply yet,{" "}
        <span className="text-[var(--color-warn)]">amber</span> = on approved
        leave (you can still assign them if you need to).
      </p>

      {drafted === "none" ? (
        <div className="mb-4">
          <Banner tone="info">
            No previous roster found — build this one manually and it will be
            used as the template next week.
          </Banner>
        </div>
      ) : null}

      {draftedSummary ? (
        <div className="mb-4">
          <Banner tone="info">{draftedSummary}</Banner>
        </div>
      ) : null}

      {canDraft ? (
        <Card className="mb-4">
          <h2 className="text-base font-semibold">Save time</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Start from last week&rsquo;s roster. We&rsquo;ll suggest the same
            people for the same shifts — but only where they&rsquo;re available.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={draftFromLastWeek}>
              <Button type="submit">Draft from last week</Button>
            </form>
            {hasSuggestions ? (
              <form action={acceptAllSuggestions}>
                <Button type="submit" variant="secondary">
                  Accept all suggestions
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="space-y-4">
        {[...byDay.entries()].map(([date, dayShifts]) => (
          <Card key={date}>
            <h2 className="text-base font-semibold">{formatDateOnly(date)}</h2>
            <ul className="mt-3 space-y-4">
              {dayShifts.map((s) => {
                const confirmedSet = confirmed.get(s.id) ?? new Set<string>();
                const suggestedSet = suggested.get(s.id) ?? new Set<string>();
                // Show free + already-assigned + no-reply first; can'ts and
                // on-leave staff last.
                const ordered = [...staff].sort((a, b) => {
                  const rank = (st: string) =>
                    onLeave(st, s.date)
                      ? 2
                      : availabilityOf(s.id, st) === "no"
                        ? 1
                        : 0;
                  return rank(a.id) - rank(b.id);
                });
                const offer = offerByShift.get(s.id);
                const scheme = shiftColorScheme(s.label);
                return (
                  <li key={s.id}>
                    <div
                      className="rounded-[8px] p-3 transition-shadow hover:shadow-[0_5px_14px_rgba(17,24,39,0.11)]"
                      style={{
                        backgroundColor: scheme.bg,
                        borderLeft: `3px solid ${scheme.bar}`,
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className="font-archivo text-[12.5px] font-bold tracking-[0.01em]"
                          style={{ color: scheme.text }}
                        >
                          {s.label}
                          {offer ? (
                            <span className="ml-2 rounded bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-brand-ink)]">
                              {offer.status === "claimed"
                                ? `Claim: ${offer.claimedByName ?? "pending"}`
                                : "Offered"}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="text-[11px] font-medium"
                          style={{ color: scheme.text, opacity: 0.75 }}
                        >
                          {formatTimeOnly(s.startTime)} –{" "}
                          {formatTimeOnly(s.endTime)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ordered.map((member) => {
                          const isConfirmed = confirmedSet.has(member.id);
                          const isSuggested = suggestedSet.has(member.id);
                          const a = availabilityOf(s.id, member.id);
                          const isPrefilled = prefilled.has(
                            `${s.id}:${member.id}`,
                          );
                          const isOnLeave = onLeave(member.id, s.date);
                          const marker =
                            a === "yes" ? "✓" : a === "no" ? "✗" : "?";

                          // Suggested (un-accepted) draft: dashed chip with
                          // Accept (tap the name) and a Clear (✕) control.
                          if (isSuggested && !isConfirmed) {
                            return (
                              <span
                                key={member.id}
                                className="inline-flex items-center overflow-hidden rounded-full border border-dashed border-[var(--color-brand)] text-sm font-medium text-[var(--color-brand)]"
                              >
                                <form action={acceptSuggestion}>
                                  <input
                                    type="hidden"
                                    name="shiftId"
                                    value={s.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="staffId"
                                    value={member.id}
                                  />
                                  <button
                                    type="submit"
                                    className="px-3 py-1.5"
                                    title="Accept this suggestion"
                                  >
                                    {member.name}{" "}
                                    <span className="ml-1 rounded bg-[var(--color-brand)] px-1 py-0.5 text-[10px] font-semibold text-[var(--color-brand-ink)]">
                                      Suggested
                                    </span>
                                  </button>
                                </form>
                                <form action={clearSuggestion}>
                                  <input
                                    type="hidden"
                                    name="shiftId"
                                    value={s.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="staffId"
                                    value={member.id}
                                  />
                                  <button
                                    type="submit"
                                    aria-label={`Clear suggestion for ${member.name}`}
                                    className="border-l border-dashed border-[var(--color-brand)] px-2 py-1.5"
                                  >
                                    <span aria-hidden="true">✕</span>
                                  </button>
                                </form>
                              </span>
                            );
                          }

                          const tone = isConfirmed
                            ? "bg-[var(--color-success)] text-white border-[var(--color-success)]"
                            : isOnLeave
                              ? "bg-[var(--color-surface)] border-[var(--color-warning)] text-[var(--color-warning)]"
                              : a === "yes"
                                ? "bg-[var(--color-surface)] border-[var(--color-success)] text-[var(--color-success)]"
                                : a === "no"
                                  ? "bg-[var(--color-surface)] border-[var(--color-danger-strong)] text-[var(--color-danger-strong)]"
                                  : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)]";
                          return (
                            <form key={member.id} action={toggleAssign}>
                              <input
                                type="hidden"
                                name="shiftId"
                                value={s.id}
                              />
                              <input
                                type="hidden"
                                name="staffId"
                                value={member.id}
                              />
                              <input
                                type="hidden"
                                name="assigned"
                                value={String(isConfirmed)}
                              />
                              <button
                                type="submit"
                                aria-pressed={isConfirmed}
                                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${tone}`}
                              >
                                {member.name}{" "}
                                <span aria-hidden="true">{marker}</span>
                                {isOnLeave ? (
                                  <span className="ml-1 rounded bg-[var(--color-warning)] px-1 py-0.5 text-[10px] font-semibold text-white">
                                    On leave
                                  </span>
                                ) : null}
                                {isPrefilled && !isConfirmed ? (
                                  <span className="ml-1 rounded bg-[var(--color-success)] px-1 py-0.5 text-[10px] font-semibold text-white">
                                    Pre-filled
                                  </span>
                                ) : null}
                              </button>
                            </form>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <RosterLegend />

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

/**
 * Visual key for the builder: shift-type colours, availability dots and the
 * on-leave pattern. Presentational only; colours come from the pure
 * shiftColorScheme helper so they stay in sync with the cards above.
 */
function RosterLegend() {
  const shiftTypes = [
    { label: "Morning", name: "Morning" },
    { label: "Afternoon", name: "Afternoon" },
    { label: "Close", name: "Close" },
    { label: "Split", name: "Split" },
  ];
  const dots = [
    { label: "Available", color: "var(--color-success)" },
    { label: "Partial", color: "var(--color-warning)" },
    { label: "No reply", color: "var(--color-text-muted)" },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-[18px] text-[12px] text-[var(--color-text-secondary)]">
      {shiftTypes.map((t) => {
        const scheme = shiftColorScheme(t.name);
        return (
          <span key={t.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[13px] w-[13px] rounded-[4px]"
              style={{
                backgroundColor: scheme.bg,
                borderLeft: `3px solid ${scheme.bar}`,
              }}
            />
            {t.label}
          </span>
        );
      })}
      <span aria-hidden="true" className="h-4 w-px bg-[var(--color-border)]" />
      {dots.map((d) => (
        <span key={d.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-[9px] w-[9px] rounded-full"
            style={{ backgroundColor: d.color }}
          />
          {d.label}
        </span>
      ))}
      <span aria-hidden="true" className="h-4 w-px bg-[var(--color-border)]" />
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-[13px] w-[13px] rounded-[4px] border border-[#EAECEF]"
          style={{
            background:
              "repeating-linear-gradient(135deg,#F4F5F7,#F4F5F7 4px,#EAECEF 4px,#EAECEF 8px)",
          }}
        />
        On leave
      </span>
    </div>
  );
}
