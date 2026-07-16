"use client";

/**
 * The roster builder's interactive weekly board: a staff × day grid where the
 * owner drags shift chips between days and people, releases them to the Open
 * shifts row, and clicks a chip to resize its times or drop in an unpaid
 * break. Colour defaults to per-EMPLOYEE (each person's stable avatar colour
 * painted across their worked span) with a per-shift-type alternative.
 *
 * All maths come from the pure src/lib/assignment-schedule.ts; all writes go
 * through server actions passed in as props (each one re-validates and
 * tenant-scopes on the server — this component is presentation + gesture
 * only). The tap-a-name editor below the board remains the fully
 * keyboard-accessible path; here, chips are buttons that open the schedule
 * editor, and dragging is a pointer shortcut for the same moves.
 */

import {
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { avatarColor } from "@/lib/avatar";
import { formatTimeOnly, formatDateOnly } from "@/lib/time";
import {
  ASSIGNMENT_BREAK_OPTIONS,
  DAY_MINUTES,
  SNAP_STEP,
  defaultBreakStart,
  findMatchingShiftOnDate,
  formatDuration,
  minutesToTime,
  normalizeTime,
  resolveSchedule,
  sameShiftTimes,
  scheduleSegments,
  snapMinutes,
  timeToMinutes,
  validateSchedule,
  workedMinutes,
} from "@/lib/assignment-schedule";
import { Avatar, Icon } from "@/components/ui";

/* ----------------------------- prop types -------------------------------- */

export type BoardScheme = { bg: string; bar: string; text: string };

export type BoardShift = {
  id: string;
  date: string;
  label: string;
  templateId: string | null;
  startTime: string; // "HH:MM"
  endTime: string;
  /** Staffing target: how many people this shift needs (≥ 1). */
  requiredStaff: number;
  scheme: BoardScheme;
  offer: { status: string; claimedByName: string | null } | null;
};

export type BoardStaff = { id: string; name: string; rateLabel: string | null };

export type BoardAssignment = {
  shiftId: string;
  staffMemberId: string;
  status: "confirmed" | "suggested";
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  breakStart: string | null;
};

export type BoardActionResult = { ok: true } | { ok: false; error: string };

export type MoveInput = {
  fromShiftId: string;
  staffMemberId: string;
  toStaffMemberId?: string | null;
  toShiftId?: string | null;
  toDate?: string | null;
};

export type AssignInput = {
  shiftId: string;
  staffMemberId: string;
  toDate?: string | null;
};

export type ScheduleInput = {
  shiftId: string;
  staffMemberId: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakStart: string | null;
};

export type PairInput = { shiftId: string; staffMemberId: string };

type Availability = "yes" | "no" | "unknown";

type Props = {
  days: string[];
  staff: BoardStaff[];
  shifts: BoardShift[];
  assignments: BoardAssignment[];
  /** `${shiftId}:${staffId}` → availability, from responses + replied-set. */
  availability: Record<string, Availability>;
  /** `${staffId}:${date}` present = on approved leave that day (flag only). */
  leave: Record<string, boolean>;
  moveAction: (input: MoveInput) => Promise<BoardActionResult>;
  assignAction: (input: AssignInput) => Promise<BoardActionResult>;
  unassignAction: (input: PairInput) => Promise<BoardActionResult>;
  scheduleAction: (input: ScheduleInput) => Promise<BoardActionResult>;
  acceptSuggestionAction: (input: PairInput) => Promise<BoardActionResult>;
  clearSuggestionAction: (input: PairInput) => Promise<BoardActionResult>;
};

/* ------------------------- optimistic reducer ---------------------------- */

type OptimisticEvent =
  | { type: "move"; from: PairInput; toShiftId: string; toStaffId: string }
  | { type: "unassign"; shiftId: string; staffId: string }
  | { type: "assign"; shiftId: string; staffId: string }
  | { type: "accept"; shiftId: string; staffId: string }
  | { type: "clear"; shiftId: string; staffId: string }
  | { type: "schedule"; input: ScheduleInput };

function applyEvent(
  list: BoardAssignment[],
  ev: OptimisticEvent,
): BoardAssignment[] {
  switch (ev.type) {
    case "move": {
      const source = list.find(
        (a) =>
          a.shiftId === ev.from.shiftId &&
          a.staffMemberId === ev.from.staffMemberId,
      );
      if (!source) return list;
      const without = list.filter(
        (a) =>
          !(
            a.shiftId === ev.from.shiftId &&
            a.staffMemberId === ev.from.staffMemberId
          ) &&
          !(a.shiftId === ev.toShiftId && a.staffMemberId === ev.toStaffId),
      );
      // The server may carry or reset the override (carrySchedule); showing
      // the chip at its destination immediately matters more than the exact
      // times, which the refresh reconciles a moment later.
      return [
        ...without,
        {
          ...source,
          shiftId: ev.toShiftId,
          staffMemberId: ev.toStaffId,
        },
      ];
    }
    case "unassign":
    case "clear":
      return list.filter(
        (a) => !(a.shiftId === ev.shiftId && a.staffMemberId === ev.staffId),
      );
    case "assign":
      return [
        ...list.filter(
          (a) => !(a.shiftId === ev.shiftId && a.staffMemberId === ev.staffId),
        ),
        {
          shiftId: ev.shiftId,
          staffMemberId: ev.staffId,
          status: "confirmed",
          startTime: null,
          endTime: null,
          breakMinutes: 0,
          breakStart: null,
        },
      ];
    case "accept":
      return list.map((a) =>
        a.shiftId === ev.shiftId && a.staffMemberId === ev.staffId
          ? { ...a, status: "confirmed" }
          : a,
      );
    case "schedule":
      return list.map((a) =>
        a.shiftId === ev.input.shiftId &&
        a.staffMemberId === ev.input.staffMemberId
          ? {
              ...a,
              startTime: ev.input.startTime,
              endTime: ev.input.endTime,
              breakMinutes: ev.input.breakMinutes,
              breakStart: ev.input.breakStart,
            }
          : a,
      );
  }
}

/* ------------------------------ helpers ---------------------------------- */

/** Soft wash of a colour for chip backgrounds ("blurry" span fill). */
function tint(hex: string, alphaHex: string): string {
  return `${hex}${alphaHex}`;
}

const AVAIL_DOT: Record<Availability, string> = {
  yes: "#16A34A",
  no: "#D97706",
  unknown: "#9CA3AF",
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayHeader(date: string): { name: string; num: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    name: WEEKDAY_SHORT[d.getUTCDay()] ?? "",
    num: String(d.getUTCDate()),
  };
}

/* ------------------------------- board ----------------------------------- */

export function RosterBoard(props: Props) {
  const router = useRouter();
  const [colorMode, setColorMode] = useState<"employee" | "type">("employee");
  const [optimistic, applyOptimistic] = useOptimistic(
    props.assignments,
    applyEvent,
  );
  const [, startTransition] = useTransition();
  const [toast, setToast] = useState<{
    tone: "ok" | "error";
    msg: string;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editor, setEditor] = useState<PairInput | null>(null);
  const [dragging, setDragging] = useState<{
    kind: "assignment" | "open";
    shiftId: string;
    staffId: string | null;
  } | null>(null);

  const showToast = useCallback((tone: "ok" | "error", msg: string) => {
    setToast({ tone, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  /** Run a board write: optimistic paint → server action → refresh. */
  const run = useCallback(
    (
      event: OptimisticEvent | null,
      fn: () => Promise<BoardActionResult>,
      okMsg?: string,
    ) => {
      startTransition(async () => {
        if (event) applyOptimistic(event);
        const res = await fn();
        if (!res.ok) showToast("error", res.error);
        else if (okMsg) showToast("ok", okMsg);
        router.refresh();
      });
    },
    [applyOptimistic, router, showToast],
  );

  const shiftById = useMemo(
    () => new Map(props.shifts.map((s) => [s.id, s])),
    [props.shifts],
  );
  const staffById = useMemo(
    () => new Map(props.staff.map((m) => [m.id, m])),
    [props.staff],
  );

  // cell[staffId][date] = that person's assignments that day (with shift).
  const { cells, openByDate, dayCounts, suggestedCount, shortfall } =
    useMemo(() => {
      const cells = new Map<string, Map<string, BoardAssignment[]>>();
      const confirmedByShift = new Map<string, number>();
      let suggestedCount = 0;
      for (const a of optimistic) {
        const shift = shiftById.get(a.shiftId);
        if (!shift) continue;
        const perStaff = cells.get(a.staffMemberId) ?? new Map();
        const list = perStaff.get(shift.date) ?? [];
        list.push(a);
        perStaff.set(shift.date, list);
        cells.set(a.staffMemberId, perStaff);
        if (a.status === "confirmed") {
          confirmedByShift.set(
            a.shiftId,
            (confirmedByShift.get(a.shiftId) ?? 0) + 1,
          );
        } else {
          suggestedCount += 1;
        }
      }
      // A shift stays in the Open row until it's FULLY staffed — hospitality
      // shifts often need several people, and "1 of 3 filled" is still open.
      const openByDate = new Map<
        string,
        Array<{ shift: BoardShift; filled: number }>
      >();
      let shortfall = 0;
      for (const s of props.shifts) {
        const filled = confirmedByShift.get(s.id) ?? 0;
        if (filled < s.requiredStaff) {
          const list = openByDate.get(s.date) ?? [];
          list.push({ shift: s, filled });
          openByDate.set(s.date, list);
          shortfall += s.requiredStaff - filled;
        }
      }
      const dayCounts = props.days.map(
        (d) =>
          props.staff.filter((m) =>
            (cells.get(m.id)?.get(d) ?? []).some(
              (a) => a.status === "confirmed",
            ),
          ).length,
      );
      return { cells, openByDate, dayCounts, suggestedCount, shortfall };
    }, [optimistic, props.shifts, props.days, props.staff, shiftById]);

  const chipColors = useCallback(
    (shift: BoardShift, staffId: string): BoardScheme => {
      if (colorMode === "type") return shift.scheme;
      const c = avatarColor(staffId);
      return { bg: tint(c, "14"), bar: c, text: "#1F2937" };
    },
    [colorMode],
  );

  /* ----------------------------- drag logic ------------------------------ */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Prefer the innermost target: a specific open block beats its day cell.
  const collision: CollisionDetection = useCallback((args) => {
    const within = pointerWithin(args);
    const pool = within.length > 0 ? within : rectIntersection(args);
    const block = pool.find((c) => String(c.id).startsWith("oblock:"));
    return block ? [block] : pool;
  }, []);

  function onDragStart(ev: DragStartEvent) {
    const id = String(ev.active.id);
    if (id.startsWith("a:")) {
      const [, shiftId = "", staffId = ""] = id.split(":");
      setDragging({ kind: "assignment", shiftId, staffId });
    } else if (id.startsWith("o:")) {
      const [, shiftId = ""] = id.split(":");
      setDragging({ kind: "open", shiftId, staffId: null });
    }
  }

  function onDragEnd(ev: DragEndEvent) {
    const drag = dragging;
    setDragging(null);
    if (!drag || !ev.over) return;
    const overId = String(ev.over.id);
    const sourceShift = shiftById.get(drag.shiftId);
    if (!sourceShift) return;

    if (drag.kind === "assignment") {
      const staffId = drag.staffId!;
      if (overId.startsWith("cell:")) {
        const [, toStaffId = "", toDate = ""] = overId.split(":");
        if (toStaffId === staffId && toDate === sourceShift.date) return;
        // Same-day drop on another person targets the SAME shift; another day
        // resolves to that day's matching block (or a clone, server-side).
        const clientTarget =
          toDate === sourceShift.date
            ? sourceShift
            : findMatchingShiftOnDate(props.shifts, sourceShift, toDate);
        run(
          clientTarget
            ? {
                type: "move",
                from: { shiftId: drag.shiftId, staffMemberId: staffId },
                toShiftId: clientTarget.id,
                toStaffId: toStaffId,
              }
            : null,
          () =>
            props.moveAction({
              fromShiftId: drag.shiftId,
              staffMemberId: staffId,
              toStaffMemberId: toStaffId,
              toDate,
            }),
          `Moved to ${formatDateOnly(toDate)}${
            toStaffId !== staffId
              ? ` — ${staffById.get(toStaffId)?.name ?? "someone else"}`
              : ""
          }`,
        );
      } else if (overId.startsWith("oblock:")) {
        const toShiftId = overId.slice("oblock:".length);
        if (toShiftId === drag.shiftId) return;
        run(
          {
            type: "move",
            from: { shiftId: drag.shiftId, staffMemberId: staffId },
            toShiftId,
            toStaffId: staffId,
          },
          () =>
            props.moveAction({
              fromShiftId: drag.shiftId,
              staffMemberId: staffId,
              toShiftId,
            }),
          "Moved to the open shift",
        );
      } else if (overId.startsWith("open:")) {
        run(
          { type: "unassign", shiftId: drag.shiftId, staffId },
          () =>
            props.unassignAction({
              shiftId: drag.shiftId,
              staffMemberId: staffId,
            }),
          "Removed — the shift is now open",
        );
      }
      return;
    }

    // Dragging an open block onto a person's cell assigns them.
    if (drag.kind === "open" && overId.startsWith("cell:")) {
      const [, toStaffId = "", toDate = ""] = overId.split(":");
      run(
        toDate === sourceShift.date
          ? { type: "assign", shiftId: drag.shiftId, staffId: toStaffId }
          : null,
        () =>
          props.assignAction({
            shiftId: drag.shiftId,
            staffMemberId: toStaffId,
            toDate,
          }),
        `${staffById.get(toStaffId)?.name ?? "Assigned"} is on ${sourceShift.label}`,
      );
    }
  }

  /* ------------------------------ render --------------------------------- */

  const gridCols = `216px repeat(${props.days.length}, minmax(132px,1fr))`;
  const editorAssignment = editor
    ? (optimistic.find(
        (a) =>
          a.shiftId === editor.shiftId &&
          a.staffMemberId === editor.staffMemberId,
      ) ?? null)
    : null;
  const editorShift = editor ? (shiftById.get(editor.shiftId) ?? null) : null;
  const editorStaff = editor
    ? (staffById.get(editor.staffMemberId) ?? null)
    : null;

  return (
    <div>
      {/* Board toolbar: colour mode + hint. */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-[12.5px] text-[var(--color-text-secondary)]">
            Drag a shift to another day or person, or to the Open shifts row to
            unassign it. Click a shift to change its times or add a break.
          </p>
          {shortfall > 0 ? (
            <span
              data-shortfall={shortfall}
              className="inline-flex items-center gap-1 rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[11.5px] font-bold text-[#92400E]"
            >
              <Icon name="group_add" className="text-[15px]" />
              {shortfall} more {shortfall === 1 ? "person" : "people"} needed
            </span>
          ) : null}
        </div>
        <div
          className="inline-flex overflow-hidden rounded-[9px] border border-[var(--color-border)]"
          role="group"
          aria-label="Colour shifts by"
        >
          {(
            [
              ["employee", "By employee"],
              ["type", "By shift type"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={colorMode === mode}
              onClick={() => setColorMode(mode)}
              className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                colorMode === mode
                  ? "bg-[var(--color-ink)] text-white"
                  : "bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)]">
          <div className="max-h-[560px] overflow-auto">
            <div
              className="grid min-w-[1060px]"
              style={{ gridTemplateColumns: gridCols }}
            >
              {/* Header row */}
              <div className="sticky left-0 top-0 z-[6] flex items-end border-b border-r border-[var(--color-border)] bg-white px-[14px] py-3">
                <span className="font-archivo text-[10.5px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-muted)]">
                  Staff member
                </span>
              </div>
              {props.days.map((d, i) => {
                const h = dayHeader(d);
                return (
                  <div
                    key={d}
                    className="sticky top-0 z-[4] border-b border-r border-[var(--color-border-subtle)] bg-[#FAFBFC] px-[11px] py-[11px]"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-archivo text-[13px] font-bold text-[var(--color-ink)]">
                        {h.name}{" "}
                        <span className="font-semibold text-[var(--color-text-muted)]">
                          {h.num}
                        </span>
                      </span>
                      <span className="rounded-full bg-[#F0F6E2] px-2 py-0.5 font-archivo text-[10.5px] font-bold text-[#5A7D17]">
                        {dayCounts[i]}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Staff rows */}
              {props.staff.map((member) => (
                <StaffRow
                  key={member.id}
                  member={member}
                  days={props.days}
                  cellAssignments={cells.get(member.id) ?? new Map()}
                  shiftById={shiftById}
                  availability={props.availability}
                  leave={props.leave}
                  chipColors={chipColors}
                  colorMode={colorMode}
                  dragging={dragging}
                  allShifts={props.shifts}
                  onOpenEditor={setEditor}
                  onAccept={(pair) =>
                    run(
                      {
                        type: "accept",
                        shiftId: pair.shiftId,
                        staffId: pair.staffMemberId,
                      },
                      () => props.acceptSuggestionAction(pair),
                      "Suggestion accepted",
                    )
                  }
                  onClear={(pair) =>
                    run(
                      {
                        type: "clear",
                        shiftId: pair.shiftId,
                        staffId: pair.staffMemberId,
                      },
                      () => props.clearSuggestionAction(pair),
                    )
                  }
                />
              ))}

              {/* Open shifts footer row */}
              <div className="sticky left-0 z-[3] flex items-center gap-2.5 border-r border-t border-[var(--color-border)] bg-[#FCFCFB] px-[13px] py-[9px]">
                <span className="flex h-[31px] w-[31px] flex-shrink-0 items-center justify-center rounded-full border border-dashed border-[#CBD5E1] text-[#94A3B8]">
                  <Icon name="add" className="text-[18px]" />
                </span>
                <div>
                  <div className="text-[13px] font-bold text-[#475569]">
                    Open shifts
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">
                    Drop here to unassign
                  </div>
                </div>
              </div>
              {props.days.map((d) => (
                <OpenCell
                  key={`open-${d}`}
                  date={d}
                  shifts={openByDate.get(d) ?? []}
                  suggestions={optimistic}
                  staffById={staffById}
                  dragging={dragging}
                />
              ))}
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <DragGhost
              dragging={dragging}
              shiftById={shiftById}
              staffById={staffById}
              assignments={optimistic}
              chipColors={chipColors}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Legend */}
      <div className="mt-[15px] flex flex-wrap items-center gap-[18px] text-[12px] text-[var(--color-text-secondary)]">
        {colorMode === "employee" ? (
          props.staff.slice(0, 8).map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-[13px] w-[13px] rounded-[4px]"
                style={{ backgroundColor: avatarColor(m.id) }}
              />
              {m.name.split(" ")[0]}
            </span>
          ))
        ) : (
          <span className="inline-flex items-center gap-1.5">
            Coloured by shift type — same palette as the Shift types page.
          </span>
        )}
        <span
          aria-hidden="true"
          className="h-[14px] w-px bg-[var(--color-border)]"
        />
        {(
          [
            ["Available", AVAIL_DOT.yes],
            ["Can't work", AVAIL_DOT.no],
            ["No reply", AVAIL_DOT.unknown],
          ] as const
        ).map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[9px] w-[9px] rounded-full"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
        {suggestedCount > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[13px] w-[13px] rounded-[4px] border border-dashed border-[var(--color-brand)]"
            />
            Suggested — tap ✓ to confirm
          </span>
        ) : null}
      </div>

      {/* Schedule editor */}
      {editor && editorAssignment && editorShift && editorStaff ? (
        <ScheduleEditor
          key={`${editor.shiftId}:${editor.staffMemberId}`}
          shift={editorShift}
          staff={editorStaff}
          assignment={editorAssignment}
          onClose={() => setEditor(null)}
          onSave={(input) => {
            setEditor(null);
            run(
              { type: "schedule", input },
              () => props.scheduleAction(input),
              "Times updated",
            );
          }}
          onUnassign={() => {
            setEditor(null);
            run(
              {
                type: "unassign",
                shiftId: editor.shiftId,
                staffId: editor.staffMemberId,
              },
              () => props.unassignAction(editor),
              "Removed — the shift is now open",
            );
          }}
        />
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          role="status"
          className={`fixed bottom-[26px] right-[26px] z-[300] flex max-w-[380px] items-center gap-2.5 rounded-[12px] px-[18px] py-[14px] text-[13.5px] font-medium text-white shadow-[0_16px_40px_rgba(0,0,0,0.28)] [animation:rosterToast_0.26s_ease] ${
            toast.tone === "error" ? "bg-[#B3261E]" : "bg-[var(--color-ink)]"
          }`}
        >
          <Icon
            name={toast.tone === "error" ? "error" : "check_circle"}
            className={`text-[21px] ${toast.tone === "error" ? "text-white" : "text-[var(--color-accent)]"}`}
          />
          <span>{toast.msg}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ staff row -------------------------------- */

function StaffRow({
  member,
  days,
  cellAssignments,
  shiftById,
  availability,
  leave,
  chipColors,
  colorMode,
  dragging,
  allShifts,
  onOpenEditor,
  onAccept,
  onClear,
}: {
  member: BoardStaff;
  days: string[];
  cellAssignments: Map<string, BoardAssignment[]>;
  shiftById: Map<string, BoardShift>;
  availability: Record<string, Availability>;
  leave: Record<string, boolean>;
  chipColors: (shift: BoardShift, staffId: string) => BoardScheme;
  colorMode: "employee" | "type";
  dragging: {
    kind: "assignment" | "open";
    shiftId: string;
    staffId: string | null;
  } | null;
  allShifts: BoardShift[];
  onOpenEditor: (pair: PairInput) => void;
  onAccept: (pair: PairInput) => void;
  onClear: (pair: PairInput) => void;
}) {
  return (
    <>
      <div className="sticky left-0 z-[3] flex items-center gap-2.5 border-b border-r border-[var(--color-border)] bg-white px-[13px] py-[9px]">
        <Avatar name={member.name} colorKey={member.id} size={31} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--color-ink)]">
            {member.name}
          </div>
          {member.rateLabel ? (
            <div className="text-[11px] text-[var(--color-text-secondary)]">
              {member.rateLabel}
            </div>
          ) : null}
        </div>
      </div>
      {days.map((d) => (
        <DayCell
          key={`${member.id}-${d}`}
          member={member}
          date={d}
          assignments={cellAssignments.get(d) ?? []}
          shiftById={shiftById}
          availability={availability}
          onLeave={Boolean(leave[`${member.id}:${d}`])}
          chipColors={chipColors}
          colorMode={colorMode}
          dragging={dragging}
          allShifts={allShifts}
          onOpenEditor={onOpenEditor}
          onAccept={onAccept}
          onClear={onClear}
        />
      ))}
    </>
  );
}

function DayCell({
  member,
  date,
  assignments,
  shiftById,
  availability,
  onLeave,
  chipColors,
  colorMode,
  dragging,
  allShifts,
  onOpenEditor,
  onAccept,
  onClear,
}: {
  member: BoardStaff;
  date: string;
  assignments: BoardAssignment[];
  shiftById: Map<string, BoardShift>;
  availability: Record<string, Availability>;
  onLeave: boolean;
  chipColors: (shift: BoardShift, staffId: string) => BoardScheme;
  colorMode: "employee" | "type";
  dragging: {
    kind: "assignment" | "open";
    shiftId: string;
    staffId: string | null;
  } | null;
  allShifts: BoardShift[];
  onOpenEditor: (pair: PairInput) => void;
  onAccept: (pair: PairInput) => void;
  onClear: (pair: PairInput) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${member.id}:${date}`,
  });

  // While a drag hovers this cell, hint at what the drop would do: green ring
  // when the person said they can work the target block, amber when they
  // can't/on leave, plus a "new shift" note when the day has no matching
  // block and the drop would clone one.
  let hint: { tone: string; note: string | null } | null = null;
  if (isOver && dragging) {
    const source = shiftById.get(dragging.shiftId);
    if (source) {
      const target =
        dragging.kind === "open" || source.date === date
          ? source.date === date
            ? source
            : findMatchingShiftOnDate(allShifts, source, date)
          : findMatchingShiftOnDate(allShifts, source, date);
      const avail = target
        ? (availability[`${target.id}:${member.id}`] ?? "unknown")
        : "unknown";
      const tone =
        onLeave || avail === "no"
          ? "ring-2 ring-[var(--color-warning)]"
          : avail === "yes"
            ? "ring-2 ring-[var(--color-success)]"
            : "ring-2 ring-[var(--color-brand)]";
      hint = {
        tone,
        note: target
          ? onLeave
            ? "On leave"
            : null
          : `New ${source.label} shift`,
      };
    }
  }

  return (
    <div
      ref={setNodeRef}
      data-cell={`${member.id}:${date}`}
      className={`relative min-h-[76px] border-b border-r border-[var(--color-border-subtle)] bg-white p-[5px] transition-shadow ${hint?.tone ?? ""}`}
    >
      {assignments.length > 0 ? (
        assignments.map((a) => {
          const shift = shiftById.get(a.shiftId);
          if (!shift) return null;
          return (
            <AssignmentChip
              key={a.shiftId}
              assignment={a}
              shift={shift}
              member={member}
              scheme={chipColors(shift, member.id)}
              colorMode={colorMode}
              availability={
                availability[`${a.shiftId}:${member.id}`] ?? "unknown"
              }
              onLeave={onLeave}
              onOpenEditor={onOpenEditor}
              onAccept={onAccept}
              onClear={onClear}
            />
          );
        })
      ) : onLeave ? (
        <div
          className="flex min-h-[62px] flex-col justify-center rounded-[8px] border border-[#EAECEF] px-[9px] py-2"
          style={{
            background:
              "repeating-linear-gradient(135deg,#F4F5F7,#F4F5F7 7px,#EAECEF 7px,#EAECEF 14px)",
          }}
        >
          <div className="font-archivo text-[11px] font-bold uppercase tracking-[0.05em] text-[#9097A1]">
            On leave
          </div>
          <div className="mt-0.5 text-[10.5px] text-[#A8AEB8]">Approved</div>
        </div>
      ) : (
        <div className="flex h-full min-h-[62px] items-center justify-center rounded-[8px] text-[20px] text-[#E2E5EA]">
          +
        </div>
      )}
      {hint?.note ? (
        <div className="pointer-events-none absolute inset-x-1 bottom-1 rounded bg-[var(--color-ink)]/80 px-1.5 py-0.5 text-center text-[10px] font-semibold text-white">
          {hint.note}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------- assignment chip ---------------------------- */

function AssignmentChip({
  assignment,
  shift,
  member,
  scheme,
  colorMode,
  availability,
  onLeave,
  onOpenEditor,
  onAccept,
  onClear,
}: {
  assignment: BoardAssignment;
  shift: BoardShift;
  member: BoardStaff;
  scheme: BoardScheme;
  colorMode: "employee" | "type";
  availability: Availability;
  onLeave: boolean;
  onOpenEditor: (pair: PairInput) => void;
  onAccept: (pair: PairInput) => void;
  onClear: (pair: PairInput) => void;
}) {
  const suggested = assignment.status === "suggested";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `a:${shift.id}:${member.id}`,
    disabled: suggested,
  });
  const schedule = resolveSchedule(shift, assignment);
  const pair: PairInput = { shiftId: shift.id, staffMemberId: member.id };

  if (suggested) {
    return (
      <div
        className="mb-1 flex min-h-[62px] flex-col gap-0.5 rounded-[8px] border-[1.5px] border-dashed border-[var(--color-brand)] bg-white px-[9px] py-2"
        data-chip={`${shift.id}:${member.id}`}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="font-archivo text-[12px] font-bold text-[var(--color-brand)]">
            {shift.label}
          </div>
          <span className="rounded bg-[var(--color-brand)] px-1 py-0.5 text-[9.5px] font-semibold text-[var(--color-brand-ink)]">
            Suggested
          </span>
        </div>
        <div className="text-[11px] text-[var(--color-text-secondary)]">
          {formatTimeOnly(schedule.startTime)} –{" "}
          {formatTimeOnly(schedule.endTime)}
        </div>
        <div className="mt-auto flex gap-1">
          <button
            type="button"
            onClick={() => onAccept(pair)}
            className="rounded bg-[var(--color-brand)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-brand-ink)]"
            title="Accept this suggestion"
          >
            ✓ Accept
          </button>
          <button
            type="button"
            onClick={() => onClear(pair)}
            aria-label={`Clear suggestion for ${member.name}`}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-chip={`${shift.id}:${member.id}`}
      className={`group relative mb-1 min-h-[62px] cursor-grab rounded-[8px] px-[9px] py-2 transition-transform hover:-translate-y-px hover:shadow-[0_5px_14px_rgba(17,24,39,0.11)] ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{
        backgroundColor: scheme.bg,
        borderLeft: `3px solid ${scheme.bar}`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute right-2 top-2 h-[9px] w-[9px] rounded-full"
        style={{ backgroundColor: AVAIL_DOT[availability] }}
      />
      <button
        type="button"
        onClick={() => onOpenEditor(pair)}
        className="block w-full text-left"
        aria-label={`${member.name}, ${shift.label} ${formatTimeOnly(schedule.startTime)} to ${formatTimeOnly(schedule.endTime)} — change times or break`}
      >
        <div
          className="truncate pr-3 font-archivo text-[12.5px] font-bold tracking-[0.01em]"
          style={{ color: colorMode === "type" ? scheme.text : "#1F2937" }}
        >
          {shift.label}
        </div>
        <div
          className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] font-medium"
          style={{
            color: colorMode === "type" ? scheme.text : "#4B5563",
            opacity: colorMode === "type" ? 0.8 : 1,
          }}
        >
          <span>
            {formatTimeOnly(schedule.startTime)} –{" "}
            {formatTimeOnly(schedule.endTime)}
          </span>
          {schedule.overridden ? (
            <span className="rounded bg-white/70 px-1 text-[9.5px] font-bold text-[#4D7C0F]">
              Custom
            </span>
          ) : null}
          {schedule.breakMinutes > 0 ? (
            <span className="rounded bg-white/70 px-1 text-[9.5px] font-bold text-[#6B7280]">
              {schedule.breakMinutes}m break
            </span>
          ) : null}
          {onLeave ? (
            <span className="rounded bg-[var(--color-warning)] px-1 text-[9.5px] font-semibold text-white">
              On leave
            </span>
          ) : null}
          {shift.offer ? (
            <span className="rounded bg-[var(--color-brand)] px-1 text-[9.5px] font-semibold text-[var(--color-brand-ink)]">
              {shift.offer.status === "claimed"
                ? `Claim: ${shift.offer.claimedByName ?? "pending"}`
                : "Offered"}
            </span>
          ) : null}
        </div>
        <TimeBar schedule={schedule} color={scheme.bar} />
      </button>
    </div>
  );
}

/**
 * The proportional day bar: a 24-hour track with the person's worked span
 * washed in colour, split by the break gap — "9am to 9pm" literally reads as
 * a long block across the day.
 */
function TimeBar({
  schedule,
  color,
}: {
  schedule: {
    startTime: string;
    endTime: string;
    breakMinutes: number;
    breakStart: string | null;
  };
  color: string;
}) {
  const segments = scheduleSegments(schedule);
  return (
    <div
      aria-hidden="true"
      className="relative mt-1.5 h-[7px] w-full overflow-hidden rounded-full bg-black/[0.06]"
    >
      {segments.map((seg) => (
        <span
          key={seg.start}
          className="absolute inset-y-0 rounded-full"
          style={{
            left: `${(seg.start / DAY_MINUTES) * 100}%`,
            width: `${((seg.end - seg.start) / DAY_MINUTES) * 100}%`,
            backgroundColor: color,
            opacity: 0.55,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------ open shifts ------------------------------ */

function OpenCell({
  date,
  shifts,
  suggestions,
  staffById,
  dragging,
}: {
  date: string;
  shifts: Array<{ shift: BoardShift; filled: number }>;
  suggestions: BoardAssignment[];
  staffById: Map<string, BoardStaff>;
  dragging: {
    kind: "assignment" | "open";
    shiftId: string;
    staffId: string | null;
  } | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `open:${date}` });
  const highlight =
    dragging?.kind === "assignment" && isOver
      ? "ring-2 ring-inset ring-[var(--color-danger-strong)]"
      : "";
  return (
    <div
      ref={setNodeRef}
      data-open-cell={date}
      className={`border-r border-t border-[var(--color-border)] bg-[#FCFCFB] p-[5px] ${highlight}`}
    >
      {shifts.length === 0 ? (
        <div className="min-h-[62px]" />
      ) : (
        shifts.map(({ shift, filled }) => (
          <OpenBlock
            key={shift.id}
            shift={shift}
            filled={filled}
            suggestedNames={suggestions
              .filter((a) => a.shiftId === shift.id && a.status === "suggested")
              .map((a) => staffById.get(a.staffMemberId)?.name ?? "")
              .filter(Boolean)}
          />
        ))
      )}
    </div>
  );
}

function OpenBlock({
  shift,
  filled,
  suggestedNames,
}: {
  shift: BoardShift;
  filled: number;
  suggestedNames: string[];
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `o:${shift.id}`,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `oblock:${shift.id}`,
  });
  const needed = Math.max(shift.requiredStaff - filled, 0);
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setDropRef(el);
      }}
      {...listeners}
      {...attributes}
      data-open-block={shift.id}
      className={`mb-1 flex min-h-[62px] cursor-grab flex-col gap-0.5 rounded-[8px] border-[1.5px] border-dashed px-[9px] py-2 ${
        filled > 0 ? "border-[var(--color-warning)]" : "border-[#CBD5E1]"
      } ${isDragging ? "opacity-40" : ""} ${
        isOver ? "ring-2 ring-[var(--color-brand)]" : ""
      }`}
      style={{
        background:
          "repeating-linear-gradient(135deg,#fff,#fff 9px,#FAFBFC 9px,#FAFBFC 18px)",
        borderLeftColor: shift.scheme.bar,
        touchAction: "none",
      }}
    >
      <div className="font-archivo text-[12px] font-bold text-[#475569]">
        Open · {shift.label}
      </div>
      <div className="text-[11px] text-[#94A3B8]">
        {formatTimeOnly(shift.startTime)} – {formatTimeOnly(shift.endTime)}
      </div>
      {shift.requiredStaff > 1 ? (
        <div className="text-[10.5px] font-bold text-[#B45309]">
          {filled} of {shift.requiredStaff} filled · needs {needed} more
        </div>
      ) : null}
      <div className="mt-auto text-[10.5px] font-bold text-[#4D7C0F]">
        {suggestedNames.length > 0
          ? `Suggested: ${suggestedNames.join(", ")}`
          : "Drag onto a person to assign"}
      </div>
    </div>
  );
}

/* ------------------------------ drag ghost ------------------------------- */

function DragGhost({
  dragging,
  shiftById,
  staffById,
  assignments,
  chipColors,
}: {
  dragging: {
    kind: "assignment" | "open";
    shiftId: string;
    staffId: string | null;
  };
  shiftById: Map<string, BoardShift>;
  staffById: Map<string, BoardStaff>;
  assignments: BoardAssignment[];
  chipColors: (shift: BoardShift, staffId: string) => BoardScheme;
}) {
  const shift = shiftById.get(dragging.shiftId);
  if (!shift) return null;
  const staff = dragging.staffId ? staffById.get(dragging.staffId) : null;
  const assignment = dragging.staffId
    ? assignments.find(
        (a) =>
          a.shiftId === dragging.shiftId &&
          a.staffMemberId === dragging.staffId,
      )
    : null;
  const schedule = resolveSchedule(shift, assignment);
  const scheme = staff
    ? chipColors(shift, staff.id)
    : { bg: "#FFFFFF", bar: shift.scheme.bar, text: "#475569" };
  return (
    <div
      className="w-[150px] cursor-grabbing rounded-[8px] px-[9px] py-2 shadow-[0_10px_28px_rgba(17,24,39,0.28)]"
      style={{
        backgroundColor: scheme.bg === "#FFFFFF" ? "#fff" : scheme.bg,
        borderLeft: `3px solid ${scheme.bar}`,
      }}
    >
      <div className="font-archivo text-[12px] font-bold text-[#1F2937]">
        {staff ? staff.name : `Open · ${shift.label}`}
      </div>
      <div className="text-[11px] text-[#4B5563]">
        {shift.label} · {formatTimeOnly(schedule.startTime)} –{" "}
        {formatTimeOnly(schedule.endTime)}
      </div>
      <TimeBar schedule={schedule} color={scheme.bar} />
    </div>
  );
}

/* ---------------------------- schedule editor ---------------------------- */

/**
 * Click-a-chip editor: a 24-hour timeline with draggable start/end handles
 * and a draggable break block, mirrored by stepper buttons and a break-length
 * choice so everything works with keyboard/touch too. Saving calls the
 * schedule server action; validation is the same pure validateSchedule the
 * server re-runs.
 */
function ScheduleEditor({
  shift,
  staff,
  assignment,
  onClose,
  onSave,
  onUnassign,
}: {
  shift: BoardShift;
  staff: BoardStaff;
  assignment: BoardAssignment;
  onClose: () => void;
  onSave: (input: ScheduleInput) => void;
  onUnassign: () => void;
}) {
  const initial = resolveSchedule(shift, assignment);
  const [startMin, setStartMin] = useState(timeToMinutes(initial.startTime));
  const [endMin, setEndMin] = useState(timeToMinutes(initial.endTime));
  const [breakMinutes, setBreakMinutes] = useState(initial.breakMinutes);
  const [breakStartMin, setBreakStartMin] = useState(
    initial.breakStart
      ? timeToMinutes(initial.breakStart)
      : timeToMinutes(
          defaultBreakStart(initial.startTime, initial.endTime, 30),
        ),
  );
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    which: "start" | "end" | "break";
    pointerId: number;
  } | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const draft = {
    startTime: minutesToTime(startMin),
    endTime: minutesToTime(endMin),
    breakMinutes,
    breakStart: breakMinutes > 0 ? minutesToTime(breakStartMin) : null,
  };
  const check = validateSchedule(draft);
  const worked = workedMinutes(draft);
  const segments = scheduleSegments(draft);
  const isDefault =
    sameShiftTimes(shift, draft) && breakMinutes === 0 ? true : false;

  const pxToMinutes = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return snapMinutes(frac * DAY_MINUTES);
  };

  const onTrackPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const m = pxToMinutes(e.clientX);
    if (drag.which === "start") {
      setStartMin(Math.min(m, endMin - SNAP_STEP));
    } else if (drag.which === "end") {
      setEndMin(Math.max(m, startMin + SNAP_STEP));
    } else {
      setBreakStartMin(
        Math.min(
          Math.max(m, startMin),
          Math.max(endMin - breakMinutes, startMin),
        ),
      );
    }
  };

  const grabHandle =
    (which: "start" | "end" | "break") => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { which, pointerId: e.pointerId };
    };
  const releaseHandle = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const stepper = (
    label: string,
    value: number,
    set: (m: number) => void,
    min: number,
    max: number,
  ) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`${label} 15 minutes earlier`}
          onClick={() => set(Math.max(value - SNAP_STEP, min))}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-[var(--color-border)] text-[16px] hover:bg-[var(--color-bg)]"
        >
          −
        </button>
        <span className="w-[74px] text-center font-archivo text-[14px] font-bold text-[var(--color-ink)]">
          {formatTimeOnly(minutesToTime(value))}
        </span>
        <button
          type="button"
          aria-label={`${label} 15 minutes later`}
          onClick={() => set(Math.min(value + SNAP_STEP, max))}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-[var(--color-border)] text-[16px] hover:bg-[var(--color-bg)]"
        >
          +
        </button>
      </div>
    </div>
  );

  const color = avatarColor(staff.id);
  const hourMarks = [0, 6, 12, 18, 24];

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Change ${staff.name}'s times on ${shift.label}`}
        className="w-full max-w-[560px] rounded-[16px] bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={staff.name} colorKey={staff.id} size={34} />
            <div>
              <div className="font-archivo text-[16px] font-bold text-[var(--color-ink)]">
                {staff.name}
              </div>
              <div className="text-[12.5px] text-[var(--color-text-secondary)]">
                {shift.label} · {formatDateOnly(shift.date)} · shift runs{" "}
                {formatTimeOnly(shift.startTime)} –{" "}
                {formatTimeOnly(shift.endTime)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        {/* Timeline */}
        <div className="mt-5">
          <div
            ref={trackRef}
            className="relative h-[46px] touch-none select-none rounded-[10px] bg-[#F3F4F6]"
            onPointerMove={onTrackPointerMove}
            onPointerUp={releaseHandle}
            onPointerCancel={releaseHandle}
          >
            {hourMarks.map((h) => (
              <span
                key={h}
                aria-hidden="true"
                className="absolute top-0 h-full w-px bg-black/[0.07]"
                style={{ left: `${(h / 24) * 100}%` }}
              />
            ))}
            {/* Worked span (split by break) */}
            {segments.map((seg) => (
              <span
                key={seg.start}
                className="absolute inset-y-[8px] rounded-[6px]"
                style={{
                  left: `${(seg.start / DAY_MINUTES) * 100}%`,
                  width: `${((seg.end - seg.start) / DAY_MINUTES) * 100}%`,
                  backgroundColor: color,
                  opacity: 0.5,
                }}
              />
            ))}
            {/* Start handle */}
            <span
              role="presentation"
              onPointerDown={grabHandle("start")}
              className="absolute inset-y-[4px] z-[2] w-[14px] cursor-ew-resize rounded-[5px] border-2 border-white shadow"
              style={{
                left: `calc(${(startMin / DAY_MINUTES) * 100}% - 7px)`,
                backgroundColor: color,
              }}
            />
            {/* End handle */}
            <span
              role="presentation"
              onPointerDown={grabHandle("end")}
              className="absolute inset-y-[4px] z-[2] w-[14px] cursor-ew-resize rounded-[5px] border-2 border-white shadow"
              style={{
                left: `calc(${(endMin / DAY_MINUTES) * 100}% - 7px)`,
                backgroundColor: color,
              }}
            />
            {/* Break block */}
            {breakMinutes > 0 ? (
              <span
                role="presentation"
                onPointerDown={grabHandle("break")}
                className="absolute inset-y-[8px] z-[1] cursor-grab rounded-[6px] border border-dashed border-[#9CA3AF] bg-white/90"
                style={{
                  left: `${(breakStartMin / DAY_MINUTES) * 100}%`,
                  width: `${(breakMinutes / DAY_MINUTES) * 100}%`,
                }}
                title="Drag to move the break"
              />
            ) : null}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-[var(--color-text-muted)]">
            {hourMarks.map((h) => (
              <span key={h}>
                {h === 0
                  ? "12am"
                  : h === 12
                    ? "12pm"
                    : h < 12
                      ? `${h}am`
                      : h === 24
                        ? "12am"
                        : `${h - 12}pm`}
              </span>
            ))}
          </div>
        </div>

        {/* Steppers */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {stepper(
            "Starts",
            startMin,
            (m) => setStartMin(m),
            0,
            endMin - SNAP_STEP,
          )}
          {stepper(
            "Finishes",
            endMin,
            (m) => setEndMin(m),
            startMin + SNAP_STEP,
            DAY_MINUTES - SNAP_STEP,
          )}
        </div>

        {/* Break */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
            Unpaid break
          </span>
          <div
            className="inline-flex overflow-hidden rounded-[9px] border border-[var(--color-border)]"
            role="group"
            aria-label="Break length"
          >
            {ASSIGNMENT_BREAK_OPTIONS.map((mins) => (
              <button
                key={mins}
                type="button"
                aria-pressed={breakMinutes === mins}
                onClick={() => {
                  setBreakMinutes(mins);
                  if (mins > 0) {
                    setBreakStartMin(
                      timeToMinutes(
                        defaultBreakStart(
                          minutesToTime(startMin),
                          minutesToTime(endMin),
                          mins,
                        ),
                      ),
                    );
                  }
                }}
                className={`px-3 py-1.5 text-[12px] font-semibold ${
                  breakMinutes === mins
                    ? "bg-[var(--color-ink)] text-white"
                    : "bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
                }`}
              >
                {mins === 0 ? "None" : mins === 60 ? "1 hour" : `${mins} min`}
              </button>
            ))}
          </div>
        </div>
        {breakMinutes > 0 ? (
          <div className="mt-2.5">
            {stepper(
              "Break starts",
              breakStartMin,
              (m) => setBreakStartMin(m),
              startMin,
              Math.max(endMin - breakMinutes, startMin),
            )}
          </div>
        ) : null}

        {/* Summary + validation */}
        <div className="mt-3 rounded-[10px] bg-[var(--color-bg)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-text-secondary)]">
          {check.ok ? (
            <>
              Working{" "}
              <strong className="text-[var(--color-ink)]">
                {formatDuration(worked)}
              </strong>{" "}
              ({formatTimeOnly(draft.startTime)} –{" "}
              {formatTimeOnly(draft.endTime)}
              {breakMinutes > 0
                ? `, ${breakMinutes} min break at ${formatTimeOnly(
                    minutesToTime(breakStartMin),
                  )}`
                : ""}
              ){isDefault ? " — the shift's own times." : ""}
            </>
          ) : (
            <span className="font-semibold text-[var(--color-danger-strong)]">
              {check.error}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStartMin(timeToMinutes(normalizeTime(shift.startTime)));
                setEndMin(timeToMinutes(normalizeTime(shift.endTime)));
                setBreakMinutes(0);
              }}
              className="rounded-[9px] border border-[var(--color-border)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
            >
              Reset to shift times
            </button>
            <button
              type="button"
              onClick={onUnassign}
              className="rounded-[9px] border border-[var(--color-danger-strong)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--color-danger-strong)] hover:bg-[#FEF2F2]"
            >
              Remove from shift
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[9px] border border-[var(--color-border)] px-4 py-2 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!check.ok}
              onClick={() =>
                onSave({
                  shiftId: shift.id,
                  staffMemberId: staff.id,
                  ...draft,
                })
              }
              className="rounded-[9px] bg-[var(--color-button)] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
            >
              Save times
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
