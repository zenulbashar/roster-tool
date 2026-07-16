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
import { Badge, Banner, Button, Card } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import { RosterBoard } from "@/components/RosterBoard";
import { z } from "zod";
import { resolveShiftColors, shiftColorScheme } from "@/lib/shift-colors";
import { validateScheduleEdit } from "@/lib/roster-schedule";

type Availability = "yes" | "no" | "unknown";

/** Inclusive list of `YYYY-MM-DD` dates from start to end (UTC-safe). */
function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  for (let t = s; t <= e; t.setUTCDate(t.getUTCDate() + 1)) {
    out.push(t.toISOString().slice(0, 10));
  }
  return out;
}

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
    templates,
  ] = await Promise.all([
    repo.listShifts(id),
    repo.listStaff({ activeOnly: true }),
    repo.listResponses(id),
    repo.listAssignments(id),
    repo.listRequests(id),
    repo.getPublished(id),
    repo.listApprovedLeaveBetween(period.startDate, period.endDate),
    repo.listActiveOffersForPeriod(id),
    repo.listTemplates(),
  ]);

  // A shift's colours come from its originating type's chosen colour (keyed by
  // templateId so a renamed type still matches), falling back to the keyword
  // scheme from the label when there's no type or no explicit colour.
  const colorByTemplateId = new Map(templates.map((t) => [t.id, t.color]));
  const schemeForShift = (s: { templateId: string | null; label: string }) =>
    resolveShiftColors(
      s.templateId ? (colorByTemplateId.get(s.templateId) ?? null) : null,
      s.label,
    );

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

  // --- Interactive board actions (typed; return {ok,error}) ------------------
  // Each re-derives businessId from the owner session and re-validates that the
  // shift(s) belong to THIS period before mutating — never trusting the client.

  async function moveAction(input: {
    fromShiftId: string;
    toShiftId: string;
    staffMemberId: string;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const [from, to] = await Promise.all([
      repo.getShift(input.fromShiftId),
      repo.getShift(input.toShiftId),
    ]);
    if (
      !from ||
      !to ||
      from.rosterPeriodId !== id ||
      to.rosterPeriodId !== id
    ) {
      return { ok: false, error: "That shift couldn't be moved." };
    }
    const row = await repo.moveAssignment(input);
    if (!row) return { ok: false, error: "That shift couldn't be moved." };
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function moveToNewDayAction(input: {
    fromShiftId: string;
    date: string;
    staffMemberId: string;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const period = await repo.getPeriod(id);
    if (!period) return { ok: false, error: "Roster not found." };
    if (!eachDate(period.startDate, period.endDate).includes(input.date)) {
      return { ok: false, error: "That day isn't in this roster." };
    }
    const src = await repo.getShift(input.fromShiftId);
    if (!src || src.rosterPeriodId !== id) {
      return { ok: false, error: "Shift not found." };
    }
    const [created] = await repo.createShifts([
      {
        rosterPeriodId: id,
        templateId: src.templateId,
        date: input.date,
        label: src.label,
        startTime: src.startTime,
        endTime: src.endTime,
      },
    ]);
    if (!created) return { ok: false, error: "Couldn't create the shift." };
    const row = await repo.moveAssignment({
      fromShiftId: input.fromShiftId,
      toShiftId: created.id,
      staffMemberId: input.staffMemberId,
    });
    if (!row) return { ok: false, error: "Couldn't move them." };
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function assignFromOpenAction(input: {
    shiftId: string;
    staffMemberId: string;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const [shift, member] = await Promise.all([
      repo.getShift(input.shiftId),
      repo.getStaff(input.staffMemberId),
    ]);
    if (!shift || shift.rosterPeriodId !== id || !member) {
      return { ok: false, error: "That assignment isn't allowed." };
    }
    await repo.assign(input.shiftId, input.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function unassignAction(input: {
    shiftId: string;
    staffMemberId: string;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const shift = await repo.getShift(input.shiftId);
    if (!shift || shift.rosterPeriodId !== id) {
      return { ok: false, error: "Shift not found." };
    }
    await repo.unassign(input.shiftId, input.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function acceptAction(input: {
    shiftId: string;
    staffMemberId: string;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const shift = await repo.getShift(input.shiftId);
    if (!shift || shift.rosterPeriodId !== id) {
      return { ok: false, error: "Shift not found." };
    }
    await repo.acceptSuggestion(input.shiftId, input.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function clearAction(input: {
    shiftId: string;
    staffMemberId: string;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const shift = await repo.getShift(input.shiftId);
    if (!shift || shift.rosterPeriodId !== id) {
      return { ok: false, error: "Shift not found." };
    }
    await repo.clearSuggestion(input.shiftId, input.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function setScheduleAction(input: {
    shiftId: string;
    staffMemberId: string;
    startMinutes: number | null;
    endMinutes: number | null;
    breakMinutes: number;
  }) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = z
      .object({
        shiftId: z.string().uuid(),
        staffMemberId: z.string().uuid(),
        startMinutes: z.number().int().min(0).max(1440).nullable(),
        endMinutes: z.number().int().min(0).max(1440).nullable(),
        breakMinutes: z.number().int().min(0).max(1440),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid times." };
    const { shiftId, staffMemberId, startMinutes, endMinutes, breakMinutes } =
      parsed.data;
    const shift = await repo.getShift(shiftId);
    if (!shift || shift.rosterPeriodId !== id) {
      return { ok: false, error: "Shift not found." };
    }
    // Null start/end -> revert to the shift's nominal times (clear override).
    if (startMinutes === null || endMinutes === null) {
      const row = await repo.setAssignmentSchedule({
        shiftId,
        staffMemberId,
        startTime: null,
        endTime: null,
        breakMinutes: 0,
      });
      if (!row) return { ok: false, error: "They're not on this shift." };
      revalidatePath(`/app/periods/${id}/build`);
      return { ok: true };
    }
    const v = validateScheduleEdit({ startMinutes, endMinutes, breakMinutes });
    if (!v.ok) return { ok: false, error: v.reason };
    const row = await repo.setAssignmentSchedule({
      shiftId,
      staffMemberId,
      startTime: v.value.start,
      endTime: v.value.end,
      breakMinutes: v.value.breakMinutes,
    });
    if (!row) return { ok: false, error: "They're not on this shift." };
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
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
  const isPublished = period.status === "published";
  const draftedSummary =
    drafted === "1" && tot
      ? draftSummary({
          totalShifts: Number(tot),
          suggestedShifts: Number(sg ?? 0),
          blankShifts: Number(tot) - Number(sg ?? 0),
          blankDueToUnavailable: Number(un ?? 0),
        })
      : null;

  // --- Interactive board data (the design's hero grid, now drag-and-drop) -----
  const days = eachDate(period.startDate, period.endDate);
  const boardStaff = staff.map((m) => ({
    id: m.id,
    name: m.name,
    rateLabel: m.rateLabel ?? null,
  }));
  const boardShifts = shifts.map((s) => ({
    id: s.id,
    date: s.date,
    templateId: s.templateId,
    label: s.label,
    startTime: s.startTime,
    endTime: s.endTime,
    color: s.templateId ? (colorByTemplateId.get(s.templateId) ?? null) : null,
  }));
  const boardAssignments = assignments.map((a) => ({
    shiftId: a.shiftId,
    staffMemberId: a.staffMemberId,
    status: a.status,
    startTime: a.startTime,
    endTime: a.endTime,
    breakMinutes: a.breakMinutes,
  }));
  // `${staffId}:${date}` keys for the on-leave cells.
  const leaveKeys: string[] = [];
  for (const m of staff) {
    for (const d of days) {
      if (onLeave(m.id, d)) leaveKeys.push(`${m.id}:${d}`);
    }
  }

  return (
    <>
      {/* Header — title + status, week label + counts, primary actions. */}
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="flex items-center gap-[11px]">
            <h1 className="font-archivo text-[25px] font-extrabold tracking-[-0.015em] text-[var(--color-ink)]">
              {rosterBuildVerb(period.status)}
            </h1>
            <Badge tone={isPublished ? "success" : "draft"}>
              {periodStatusLabel(period.status)}
            </Badge>
          </div>
          <div className="mt-[7px] flex flex-wrap items-center gap-[9px] text-[13px] text-[var(--color-text-secondary)]">
            <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
              {period.label} · {formatDateOnly(period.startDate)} –{" "}
              {formatDateOnly(period.endDate)}
            </span>
            <span className="text-[var(--color-line)]">·</span>
            <span>{staff.length} staff</span>
            <span className="text-[var(--color-line)]">·</span>
            <span>{shifts.length} shifts rostered</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {canDraft ? (
            <form action={draftFromLastWeek}>
              <Button type="submit" variant="secondary">
                <span className="material-symbols-rounded text-[18px] text-[var(--color-accent)]">
                  auto_awesome
                </span>
                Draft from last week
              </Button>
            </form>
          ) : null}
          {isPublished ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-[10px] border border-[#BBF7D0] bg-[#ECFDF3] px-[16px] py-[11px] font-archivo text-[13.5px] font-bold text-[#15803D]">
                <span className="material-symbols-rounded text-[18px]">
                  check_circle
                </span>
                Published
              </span>
              {published ? (
                <CopyButton
                  value={`/r/${published.publicSlug}`}
                  label="Copy link"
                />
              ) : null}
            </>
          ) : (
            <form action={publish}>
              <Button type="submit">
                <span className="material-symbols-rounded text-[18px]">
                  send
                </span>
                Publish roster
              </Button>
            </form>
          )}
        </div>
      </div>

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
      {isPublished && published ? (
        <div className="mb-4">
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

      {/* Weekly board — drag-and-drop staff × day matrix. */}
      <RosterBoard
        periodId={id}
        days={days}
        staff={boardStaff}
        shifts={boardShifts}
        assignments={boardAssignments}
        leaveKeys={leaveKeys}
        canEdit={!isPublished}
        onMove={moveAction}
        onMoveToNewDay={moveToNewDayAction}
        onAssignFromOpen={assignFromOpenAction}
        onUnassign={unassignAction}
        onAccept={acceptAction}
        onClear={clearAction}
        onSetSchedule={setScheduleAction}
      />

      <RosterLegend />

      {/* Assignment editor — the interactive tool (tap names to roster). */}
      <div className="mt-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-archivo text-[18px] font-bold text-[var(--color-ink)]">
              Assign staff
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
              {respondedCount} of {requests.length} replied. Tap a name to put
              them on a shift.{" "}
              <span className="text-[var(--color-ok)]">Green</span> = free,{" "}
              <span className="text-[var(--color-danger)]">red</span> =
              can&rsquo;t, grey = no reply,{" "}
              <span className="text-[var(--color-warn)]">amber</span> = on
              approved leave.
            </p>
          </div>
          {hasSuggestions ? (
            <form action={acceptAllSuggestions}>
              <Button type="submit" variant="secondary">
                Accept all suggestions
              </Button>
            </form>
          ) : null}
        </div>

        <div className="space-y-4">
          {[...byDay.entries()].map(([date, dayShifts]) => (
            <Card key={date}>
              <h3 className="font-archivo text-[15px] font-bold text-[var(--color-ink)]">
                {formatDateOnly(date)}
              </h3>
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
                  const scheme = schemeForShift(s);
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
      </div>

      {/* Publish (also available in the header). */}
      {!isPublished ? (
        <Card className="mt-6">
          <h2 className="font-archivo text-[18px] font-bold text-[var(--color-ink)]">
            Publish &amp; send
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            We&rsquo;ll email everyone their shifts and create a shareable
            roster link.
          </p>
          <form action={publish} className="mt-3">
            <Button type="submit">Publish roster</Button>
          </form>
        </Card>
      ) : null}

      <div className="mt-6">
        <Link
          href={`/app/periods/${id}`}
          className="text-[13px] font-semibold text-[var(--color-brand)] underline underline-offset-2"
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
    { label: "Available", color: "#16A34A" },
    { label: "Partial", color: "#D97706" },
    { label: "No response", color: "#9CA3AF" },
  ];
  return (
    <div className="mt-[15px] flex flex-wrap items-center gap-[18px] text-[12px] text-[var(--color-text-secondary)]">
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
      <span
        aria-hidden="true"
        className="h-[14px] w-px bg-[var(--color-border)]"
      />
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
      <span
        aria-hidden="true"
        className="h-[14px] w-px bg-[var(--color-border)]"
      />
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-[13px] w-[14px] rounded-[4px] border border-[#EAECEF]"
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
