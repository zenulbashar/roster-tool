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
import { resolveShiftColors } from "@/lib/shift-colors";
import {
  findMatchingShiftOnDate,
  normalizeTime,
  sameShiftTimes,
  validateSchedule,
} from "@/lib/assignment-schedule";
import {
  assignmentMoveSchema,
  assignmentPairSchema,
  assignmentScheduleSchema,
  openShiftAssignSchema,
  shiftRequiredStaffSchema,
} from "@/lib/validation";
import { RosterBoard, type BoardActionResult } from "@/components/RosterBoard";

type Availability = "yes" | "no" | "unknown";

/**
 * The shift a board drop lands on for a given day: the source shift itself
 * (same-day person change), the day's matching block (same type), or a clone
 * of the source block created on that day. Null = a date outside the period.
 * Module-scope (not a closure) so the server actions can share it.
 */
async function resolveShiftForDate(
  repo: ReturnType<typeof createTenantRepo>,
  periodId: string,
  period: { startDate: string; endDate: string },
  sourceShift: {
    id: string;
    templateId: string | null;
    label: string;
    startTime: string;
    endTime: string;
    date: string;
    requiredStaff: number;
  },
  toDate: string,
): Promise<string | null> {
  if (toDate < period.startDate || toDate > period.endDate) return null;
  if (toDate === sourceShift.date) return sourceShift.id;
  const all = await repo.listShifts(periodId);
  const match = findMatchingShiftOnDate(all, sourceShift, toDate);
  if (match) return match.id;
  const [clone] = await repo.createShifts([
    {
      rosterPeriodId: periodId,
      templateId: sourceShift.templateId,
      date: toDate,
      label: sourceShift.label,
      startTime: normalizeTime(sourceShift.startTime),
      endTime: normalizeTime(sourceShift.endTime),
      requiredStaff: sourceShift.requiredStaff,
    },
  ]);
  return clone?.id ?? null;
}

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
    sh?: string;
  }>;
}) {
  const { id } = await params;
  const { drafted, sg, tot, un, sh } = await searchParams;
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

    const [
      currentShifts,
      lastAssignments,
      responses,
      leave,
      activeStaff,
      currentAssignments,
    ] = await Promise.all([
      repo.listShifts(id),
      repo.assignmentsWithShiftType(last.id),
      repo.listResponses(id),
      repo.listApprovedLeaveBetween(period.startDate, period.endDate),
      repo.listStaff({ activeOnly: true }),
      repo.listAssignments(id),
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
      // Fill-to-target: top understaffed shifts up from everyone who said
      // yes, after last week's crew took their slots.
      staffIds: activeStaff.map((m) => m.id),
      existingAssignments: currentAssignments.map((a) => ({
        shiftId: a.shiftId,
        staffMemberId: a.staffMemberId,
      })),
    });

    await repo.createSuggestedAssignments(suggestions);

    redirect(
      `/app/periods/${id}/build?drafted=1&sg=${counts.suggestedShifts}&tot=${counts.totalShifts}&un=${counts.blankDueToUnavailable}&sh=${counts.shortShifts ?? 0}`,
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

  /* ----- Roster board actions (drag-and-drop) -----------------------------
   * Each takes a JSON payload from the client board, zod-validates it, and
   * re-derives every id through the tenant repo — the client can only point
   * at things; the server decides. All return { ok } | { ok, error } so the
   * board can toast failures without crashing.
   */

  async function moveAssignmentAction(
    raw: unknown,
  ): Promise<BoardActionResult> {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = assignmentMoveSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, error: "That move didn't make sense — try again." };
    const input = parsed.data;

    const [period, fromShift, member] = await Promise.all([
      repo.getPeriod(id),
      repo.getShift(input.fromShiftId),
      repo.getStaff(input.toStaffMemberId ?? input.staffMemberId),
    ]);
    if (!period || !fromShift || fromShift.rosterPeriodId !== id)
      return { ok: false, error: "That shift isn't part of this roster." };
    if (!member) return { ok: false, error: "That staff member wasn't found." };

    let toShiftId = input.toShiftId ?? null;
    if (toShiftId) {
      const target = await repo.getShift(toShiftId);
      if (!target || target.rosterPeriodId !== id)
        return { ok: false, error: "That shift isn't part of this roster." };
    } else if (input.toDate) {
      toShiftId = await resolveShiftForDate(
        repo,
        id,
        period,
        fromShift,
        input.toDate,
      );
      if (!toShiftId)
        return { ok: false, error: "That day isn't part of this roster." };
    } else {
      return { ok: false, error: "Nowhere to move that shift to." };
    }

    const moved = await repo.moveAssignment({
      fromShiftId: input.fromShiftId,
      staffMemberId: input.staffMemberId,
      toShiftId,
      toStaffMemberId: input.toStaffMemberId ?? undefined,
    });
    if (!moved)
      return {
        ok: false,
        error:
          "Couldn't move that shift — it may have just changed. Refresh and try again.",
      };
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function assignOpenShiftAction(
    raw: unknown,
  ): Promise<BoardActionResult> {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = openShiftAssignSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, error: "That drop didn't make sense — try again." };
    const input = parsed.data;

    const [period, shift, member] = await Promise.all([
      repo.getPeriod(id),
      repo.getShift(input.shiftId),
      repo.getStaff(input.staffMemberId),
    ]);
    if (!period || !shift || shift.rosterPeriodId !== id)
      return { ok: false, error: "That shift isn't part of this roster." };
    if (!member) return { ok: false, error: "That staff member wasn't found." };

    let targetId: string | null = shift.id;
    if (input.toDate && input.toDate !== shift.date) {
      targetId = await resolveShiftForDate(
        repo,
        id,
        period,
        shift,
        input.toDate,
      );
      if (!targetId)
        return { ok: false, error: "That day isn't part of this roster." };
    }
    await repo.assign(targetId, input.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function unassignAction(raw: unknown): Promise<BoardActionResult> {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = assignmentPairSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Try again." };
    const shift = await repo.getShift(parsed.data.shiftId);
    if (!shift || shift.rosterPeriodId !== id)
      return { ok: false, error: "That shift isn't part of this roster." };
    await repo.unassign(parsed.data.shiftId, parsed.data.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function setScheduleAction(raw: unknown): Promise<BoardActionResult> {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = assignmentScheduleSchema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, error: "Those times didn't make sense — try again." };
    const input = parsed.data;
    const check = validateSchedule({
      startTime: input.startTime,
      endTime: input.endTime,
      breakMinutes: input.breakMinutes,
      breakStart: input.breakMinutes > 0 ? input.breakStart : null,
    });
    if (!check.ok) return { ok: false, error: check.error };

    const shift = await repo.getShift(input.shiftId);
    if (!shift || shift.rosterPeriodId !== id)
      return { ok: false, error: "That shift isn't part of this roster." };

    // Times equal to the shift's own collapse back to "no override" so the
    // chip doesn't show a misleading Custom badge; a break can ride alone.
    const timesMatch = sameShiftTimes(shift, {
      startTime: input.startTime,
      endTime: input.endTime,
    });
    const stored =
      timesMatch && input.breakMinutes === 0
        ? null
        : {
            startTime: timesMatch ? null : input.startTime,
            endTime: timesMatch ? null : input.endTime,
            breakMinutes: input.breakMinutes,
            breakStart: input.breakMinutes > 0 ? input.breakStart : null,
          };
    const row = await repo.setAssignmentSchedule(
      input.shiftId,
      input.staffMemberId,
      stored,
    );
    if (!row)
      return { ok: false, error: "That person is no longer on this shift." };
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function acceptSuggestionBoardAction(
    raw: unknown,
  ): Promise<BoardActionResult> {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = assignmentPairSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Try again." };
    const shift = await repo.getShift(parsed.data.shiftId);
    if (!shift || shift.rosterPeriodId !== id)
      return { ok: false, error: "That shift isn't part of this roster." };
    await repo.acceptSuggestion(parsed.data.shiftId, parsed.data.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  async function clearSuggestionBoardAction(
    raw: unknown,
  ): Promise<BoardActionResult> {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = assignmentPairSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Try again." };
    const shift = await repo.getShift(parsed.data.shiftId);
    if (!shift || shift.rosterPeriodId !== id)
      return { ok: false, error: "That shift isn't part of this roster." };
    await repo.clearSuggestion(parsed.data.shiftId, parsed.data.staffMemberId);
    revalidatePath(`/app/periods/${id}/build`);
    return { ok: true };
  }

  /**
   * The tap editor's "Needs N" stepper — adjust one shift's staffing target.
   * A target only: it flags shortfalls, never blocks assigning or publishing.
   */
  async function setShiftStaffNeed(formData: FormData) {
    "use server";
    const { businessId } = await requireOwner();
    const repo = createTenantRepo(businessId);
    const parsed = shiftRequiredStaffSchema.safeParse({
      shiftId: formData.get("shiftId"),
      requiredStaff: formData.get("requiredStaff"),
    });
    if (!parsed.success) return;
    const shift = await repo.getShift(parsed.data.shiftId);
    if (!shift || shift.rosterPeriodId !== id) return;
    await repo.updateShiftRequiredStaff(
      parsed.data.shiftId,
      parsed.data.requiredStaff,
    );
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
  const isPublished = period.status === "published";
  const draftedSummary =
    drafted === "1" && tot
      ? draftSummary({
          totalShifts: Number(tot),
          suggestedShifts: Number(sg ?? 0),
          blankShifts: Number(tot) - Number(sg ?? 0),
          blankDueToUnavailable: Number(un ?? 0),
          shortShifts: Number(sh ?? 0),
        })
      : null;

  // --- Roster board (drag-and-drop weekly grid) -----------------------------
  const days = eachDate(period.startDate, period.endDate);
  const boardShifts = shifts.map((s) => ({
    id: s.id,
    date: s.date,
    label: s.label,
    templateId: s.templateId,
    startTime: normalizeTime(s.startTime),
    endTime: normalizeTime(s.endTime),
    requiredStaff: s.requiredStaff,
    scheme: schemeForShift(s),
    offer: offerByShift.get(s.id) ?? null,
  }));
  const boardStaff = staff.map((m) => ({
    id: m.id,
    name: m.name,
    rateLabel: m.rateLabel ?? null,
  }));
  const boardAssignments = assignments.map((a) => ({
    shiftId: a.shiftId,
    staffMemberId: a.staffMemberId,
    status: a.status,
    startTime: a.startTime ? normalizeTime(a.startTime) : null,
    endTime: a.endTime ? normalizeTime(a.endTime) : null,
    breakMinutes: a.breakMinutes,
    breakStart: a.breakStart ? normalizeTime(a.breakStart) : null,
  }));
  const boardAvailability: Record<string, Availability> = {};
  for (const s of shifts) {
    for (const m of staff) {
      boardAvailability[`${s.id}:${m.id}`] = availabilityOf(s.id, m.id);
    }
  }
  const boardLeave: Record<string, boolean> = {};
  for (const m of staff) {
    for (const d of days) {
      if (onLeave(m.id, d)) boardLeave[`${m.id}:${d}`] = true;
    }
  }

  // Staffing shortfall across the period: how many more people are needed to
  // hit every shift's target. A FLAG shown before publish — never a block.
  const understaffed = shifts
    .map((s) => ({
      shift: s,
      filled: confirmed.get(s.id)?.size ?? 0,
    }))
    .filter(({ shift, filled }) => filled < shift.requiredStaff);
  const shortfallTotal = understaffed.reduce(
    (sum, { shift, filled }) => sum + (shift.requiredStaff - filled),
    0,
  );

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
      {shortfallTotal > 0 ? (
        <div className="mb-4">
          <Banner tone="warn">
            {understaffed.length}{" "}
            {understaffed.length === 1
              ? "shift still needs"
              : "shifts still need"}{" "}
            more people ({shortfallTotal} more in total). You can publish anyway
            — unfilled spots stay in the Open shifts row.
          </Banner>
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

      {/* Weekly board — drag-and-drop staff × day grid. */}
      <RosterBoard
        days={days}
        staff={boardStaff}
        shifts={boardShifts}
        assignments={boardAssignments}
        availability={boardAvailability}
        leave={boardLeave}
        moveAction={moveAssignmentAction}
        assignAction={assignOpenShiftAction}
        unassignAction={unassignAction}
        scheduleAction={setScheduleAction}
        acceptSuggestionAction={acceptSuggestionBoardAction}
        clearSuggestionAction={clearSuggestionBoardAction}
      />

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
                        {/* Staffing target: filled count + a −/+ stepper.
                            A flag, never a cap — the owner can always assign
                            more or fewer people than the target. */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                          <span
                            className={`font-semibold ${
                              confirmedSet.size < s.requiredStaff
                                ? "text-[#B45309]"
                                : "text-[var(--color-text-secondary)]"
                            }`}
                          >
                            {confirmedSet.size} of {s.requiredStaff} assigned
                            {confirmedSet.size < s.requiredStaff
                              ? ` · needs ${s.requiredStaff - confirmedSet.size} more`
                              : ""}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <form action={setShiftStaffNeed}>
                              <input
                                type="hidden"
                                name="shiftId"
                                value={s.id}
                              />
                              <input
                                type="hidden"
                                name="requiredStaff"
                                value={Math.max(s.requiredStaff - 1, 1)}
                              />
                              <button
                                type="submit"
                                disabled={s.requiredStaff <= 1}
                                aria-label={`${s.label} needs one person fewer`}
                                className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border border-black/10 bg-white/70 text-[13px] leading-none disabled:opacity-40"
                              >
                                −
                              </button>
                            </form>
                            <form action={setShiftStaffNeed}>
                              <input
                                type="hidden"
                                name="shiftId"
                                value={s.id}
                              />
                              <input
                                type="hidden"
                                name="requiredStaff"
                                value={Math.min(s.requiredStaff + 1, 20)}
                              />
                              <button
                                type="submit"
                                disabled={s.requiredStaff >= 20}
                                aria-label={`${s.label} needs one person more`}
                                className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border border-black/10 bg-white/70 text-[13px] leading-none disabled:opacity-40"
                              >
                                +
                              </button>
                            </form>
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
