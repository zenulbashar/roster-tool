"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { avatarColor } from "@/lib/avatar";
import { resolveShiftColors } from "@/lib/shift-colors";
import {
  resolveSchedule,
  formatDuration,
  timeToMinutes,
  minutesToTime,
} from "@/lib/roster-schedule";
import { chooseTargetShift } from "@/lib/roster-drag";
import { formatTimeOnly } from "@/lib/time";
import { Avatar, Button } from "@/components/ui";
import {
  ShiftScheduleEditor,
  type EditorTarget,
} from "@/components/ShiftScheduleEditor";

export type BoardShift = {
  id: string;
  date: string;
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
  color: string | null;
};
export type BoardAssignment = {
  shiftId: string;
  staffMemberId: string;
  status: "suggested" | "confirmed";
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
};
type BoardStaff = { id: string; name: string; rateLabel: string | null };
export type ActionResult = { ok: boolean; error?: string };

type ColorMode = "employee" | "type";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Proportional-bar window: 6am → midnight covers hospitality shifts.
const BAR_START = 6 * 60;
const BAR_END = 24 * 60;

function dayHeader(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    name: WEEKDAY_SHORT[d.getUTCDay()] ?? "",
    date: String(d.getUTCDate()),
  };
}

export function RosterBoard(props: {
  periodId: string;
  days: string[];
  staff: BoardStaff[];
  shifts: BoardShift[];
  assignments: BoardAssignment[];
  leaveKeys: string[]; // `${staffId}:${date}`
  canEdit: boolean;
  onMove: (i: {
    fromShiftId: string;
    toShiftId: string;
    staffMemberId: string;
  }) => Promise<ActionResult>;
  onMoveToNewDay: (i: {
    fromShiftId: string;
    date: string;
    staffMemberId: string;
  }) => Promise<ActionResult>;
  onAssignFromOpen: (i: {
    shiftId: string;
    staffMemberId: string;
  }) => Promise<ActionResult>;
  onUnassign: (i: {
    shiftId: string;
    staffMemberId: string;
  }) => Promise<ActionResult>;
  onAccept: (i: {
    shiftId: string;
    staffMemberId: string;
  }) => Promise<ActionResult>;
  onClear: (i: {
    shiftId: string;
    staffMemberId: string;
  }) => Promise<ActionResult>;
  onSetSchedule: (i: {
    shiftId: string;
    staffMemberId: string;
    startMinutes: number | null;
    endMinutes: number | null;
    breakMinutes: number;
  }) => Promise<ActionResult>;
}) {
  const {
    days,
    staff,
    shifts,
    assignments,
    leaveKeys,
    canEdit,
    onMove,
    onMoveToNewDay,
    onAssignFromOpen,
    onUnassign,
    onAccept,
    onClear,
    onSetSchedule,
  } = props;

  const [colorMode, setColorMode] = useState<ColorMode>("employee");
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [savingEditor, setSavingEditor] = useState(false);
  const [choose, setChoose] = useState<null | {
    candidates: BoardShift[];
    fromShiftId: string;
    staffMemberId: string;
  }>(null);
  const [create, setCreate] = useState<null | {
    date: string;
    fromShiftId: string;
    staffMemberId: string;
    label: string;
  }>(null);

  const leaveSet = useMemo(() => new Set(leaveKeys), [leaveKeys]);
  const shiftById = useMemo(
    () => new Map(shifts.map((s) => [s.id, s])),
    [shifts],
  );
  const shiftsByDate = useMemo(() => {
    const m = new Map<string, BoardShift[]>();
    for (const s of shifts)
      (m.get(s.date) ?? m.set(s.date, []).get(s.date)!).push(s);
    return m;
  }, [shifts]);

  // cell[staffId][date] = assignments that person holds that day.
  const cell = useMemo(() => {
    const m = new Map<string, Map<string, BoardAssignment[]>>();
    for (const a of assignments) {
      const s = shiftById.get(a.shiftId);
      if (!s) continue;
      const perStaff =
        m.get(a.staffMemberId) ?? new Map<string, BoardAssignment[]>();
      const list = perStaff.get(s.date) ?? [];
      list.push(a);
      perStaff.set(s.date, list);
      m.set(a.staffMemberId, perStaff);
    }
    return m;
  }, [assignments, shiftById]);

  // A shift with no CONFIRMED assignment is "open" for that day.
  const openByDate = useMemo(() => {
    const confirmed = new Set(
      assignments.filter((a) => a.status === "confirmed").map((a) => a.shiftId),
    );
    const m = new Map<string, BoardShift[]>();
    for (const s of shifts) {
      if (confirmed.has(s.id)) continue;
      (m.get(s.date) ?? m.set(s.date, []).get(s.date)!).push(s);
    }
    return m;
  }, [assignments, shifts]);

  const dayCounts = days.map(
    (d) =>
      staff.filter((m) => (cell.get(m.id)?.get(d)?.length ?? 0) > 0).length,
  );
  const gridCols = `216px repeat(${days.length}, minmax(140px,1fr))`;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  function schemeFor(s: BoardShift, staffId: string) {
    if (colorMode === "type") return resolveShiftColors(s.color, s.label);
    const bar = avatarColor(staffId);
    return { bar, bg: `${bar}1A`, text: "var(--color-ink)" };
  }

  async function run(fn: () => Promise<ActionResult>) {
    setPending(true);
    try {
      const r = await fn();
      if (!r.ok) setToast(r.error ?? "Couldn't save that change.");
    } catch {
      setToast("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;
    const a = active.data.current as
      | { kind: "assignment"; shiftId: string; staffMemberId: string }
      | { kind: "open"; shiftId: string; date: string }
      | undefined;
    const o = over.data.current as
      | { kind: "cell"; staffMemberId: string; date: string }
      | { kind: "openrow"; date: string }
      | undefined;
    if (!a || !o) return;

    // Drop an assigned chip onto the open row -> unassign (release).
    if (a.kind === "assignment" && o.kind === "openrow") {
      run(() =>
        onUnassign({ shiftId: a.shiftId, staffMemberId: a.staffMemberId }),
      );
      return;
    }
    // Drop an open shift onto a staff cell of the SAME day -> assign.
    if (a.kind === "open" && o.kind === "cell") {
      if (a.date !== o.date) {
        setToast("Drop an open shift onto that same day's row.");
        return;
      }
      run(() =>
        onAssignFromOpen({
          shiftId: a.shiftId,
          staffMemberId: o.staffMemberId,
        }),
      );
      return;
    }
    // Move an assigned chip onto a staff cell.
    if (a.kind === "assignment" && o.kind === "cell") {
      const src = shiftById.get(a.shiftId);
      if (!src) return;
      // Same person, same day -> nothing to do.
      if (a.staffMemberId === o.staffMemberId && src.date === o.date) return;

      const dayShifts = shiftsByDate.get(o.date) ?? [];
      const res = chooseTargetShift(src, dayShifts, a.shiftId);
      if (res.kind === "assign") {
        // Moving to the same shift but a different person isn't a "move";
        // guard against dropping onto a shift the target already holds handled
        // server-side via onConflict. Reassign the current person off, put the
        // target person on the matched shift.
        moveOrReassign(a, res.shiftId, o.staffMemberId, src.date);
      } else if (res.kind === "choose") {
        setChoose({
          candidates: res.shiftIds
            .map((id) => shiftById.get(id))
            .filter(Boolean) as BoardShift[],
          fromShiftId: a.shiftId,
          staffMemberId: o.staffMemberId,
        });
      } else {
        setCreate({
          date: o.date,
          fromShiftId: a.shiftId,
          staffMemberId: o.staffMemberId,
          label: src.label,
        });
      }
    }
  }

  // Move keeps the SAME person (a.staffMemberId) — dragging a chip re-homes that
  // person's shift. Dropping onto another person's row moves the shift to the
  // dropped-on person.
  function moveOrReassign(
    a: { shiftId: string; staffMemberId: string },
    toShiftId: string,
    dropStaffId: string,
    _srcDate: string,
  ) {
    if (dropStaffId === a.staffMemberId) {
      run(() =>
        onMove({
          fromShiftId: a.shiftId,
          toShiftId,
          staffMemberId: a.staffMemberId,
        }),
      );
    } else {
      // Dropped on a different person: that person takes the shift.
      run(async () => {
        const r1 = await onUnassign({
          shiftId: a.shiftId,
          staffMemberId: a.staffMemberId,
        });
        if (!r1.ok) return r1;
        return onAssignFromOpen({
          shiftId: toShiftId,
          staffMemberId: dropStaffId,
        });
      });
    }
  }

  function openEditor(a: BoardAssignment) {
    const s = shiftById.get(a.shiftId);
    if (!s) return;
    const r = resolveSchedule(a, s);
    setEditor({
      shiftId: a.shiftId,
      staffMemberId: a.staffMemberId,
      staffName: staff.find((m) => m.id === a.staffMemberId)?.name ?? "",
      shiftLabel: s.label,
      nominalStart: minutesToTime(timeToMinutes(s.startTime)),
      nominalEnd: minutesToTime(timeToMinutes(s.endTime)),
      start: r.start,
      end: r.end,
      breakMinutes: r.breakMinutes,
      color: avatarColor(a.staffMemberId),
    });
  }

  const activeChip = useMemo(() => {
    if (!dragId) return null;
    if (dragId.startsWith("a:")) {
      const [, shiftId, staffId] = dragId.split(":");
      const a = assignments.find(
        (x) => x.shiftId === shiftId && x.staffMemberId === staffId,
      );
      const s = a && shiftById.get(a.shiftId);
      if (a && s)
        return (
          <ChipBody
            a={a}
            shift={s}
            scheme={schemeFor(s, a.staffMemberId)}
            dragging
          />
        );
    }
    if (dragId.startsWith("o:")) {
      const s = shiftById.get(dragId.slice(2));
      if (s)
        return (
          <OpenChip
            shift={s}
            scheme={resolveShiftColors(s.color, s.label)}
            dragging
          />
        );
    }
    return null;
  }, [dragId, assignments, shiftById, colorMode]);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-[var(--color-text-secondary)]">
          {canEdit
            ? "Drag a shift across the grid to move it; drag to Open shifts to release. Tap a shift to set its hours and break."
            : "This roster is published — reopen it to make changes."}
        </p>
        <div className="inline-flex items-center gap-1.5 text-[12px]">
          <span className="text-[var(--color-text-muted)]">Colour by</span>
          <div className="inline-flex overflow-hidden rounded-[8px] border border-[var(--color-border)]">
            {(["employee", "type"] as ColorMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setColorMode(m)}
                className={`px-2.5 py-1 font-semibold capitalize ${
                  colorMode === m
                    ? "bg-[var(--color-ink)] text-white"
                    : "bg-white text-[var(--color-ink)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)]">
          <div className="max-h-[600px] overflow-auto">
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
              {days.map((d, i) => {
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
                          {h.date}
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
              {staff.map((member) => (
                <StaffRow
                  key={member.id}
                  member={member}
                  days={days}
                  assignmentsByDate={cell.get(member.id) ?? new Map()}
                  shiftById={shiftById}
                  leaveSet={leaveSet}
                  canEdit={canEdit}
                  schemeFor={schemeFor}
                  onOpenEditor={openEditor}
                  onAccept={(sh) =>
                    run(() =>
                      onAccept({ shiftId: sh, staffMemberId: member.id }),
                    )
                  }
                  onClear={(sh) =>
                    run(() =>
                      onClear({ shiftId: sh, staffMemberId: member.id }),
                    )
                  }
                />
              ))}

              {/* Open shifts footer */}
              <div className="sticky left-0 z-[3] flex items-center gap-2.5 border-r border-t border-[var(--color-border)] bg-[#FCFCFB] px-[13px] py-[9px]">
                <span className="flex h-[31px] w-[31px] flex-shrink-0 items-center justify-center rounded-full border border-dashed border-[#CBD5E1] text-[#94A3B8]">
                  <span className="material-symbols-rounded text-[18px]">
                    add
                  </span>
                </span>
                <div>
                  <div className="text-[13px] font-bold text-[#475569]">
                    Open shifts
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">
                    Unassigned
                  </div>
                </div>
              </div>
              {days.map((d) => (
                <OpenCell
                  key={`open-${d}`}
                  date={d}
                  shifts={openByDate.get(d) ?? []}
                  canEdit={canEdit}
                />
              ))}
            </div>
          </div>
        </div>

        <DragOverlay dropAnimation={null}>{activeChip}</DragOverlay>
      </DndContext>

      {/* Choose-target popover */}
      {choose ? (
        <MiniModal title="Which shift?" onClose={() => setChoose(null)}>
          <div className="space-y-2">
            {choose.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  const fromShiftId = choose.fromShiftId;
                  const staffMemberId = choose.staffMemberId;
                  setChoose(null);
                  run(() =>
                    onMove({ fromShiftId, toShiftId: c.id, staffMemberId }),
                  );
                }}
                className="flex w-full items-center justify-between rounded-[9px] border border-[var(--color-border)] px-3 py-2 text-left hover:border-[var(--color-accent)]"
              >
                <span className="font-archivo text-[13px] font-bold text-[var(--color-ink)]">
                  {c.label}
                </span>
                <span className="text-[12px] text-[var(--color-text-secondary)]">
                  {formatTimeOnly(c.startTime)} – {formatTimeOnly(c.endTime)}
                </span>
              </button>
            ))}
          </div>
        </MiniModal>
      ) : null}

      {/* Create-on-empty-day confirm */}
      {create ? (
        <MiniModal
          title="No matching shift that day"
          onClose={() => setCreate(null)}
        >
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            There&rsquo;s no <strong>{create.label}</strong> shift on{" "}
            {dayHeader(create.date).name} {dayHeader(create.date).date}. Create
            it and move them there?
          </p>
          <div className="mt-4 flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setCreate(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const c = create;
                setCreate(null);
                run(() =>
                  onMoveToNewDay({
                    fromShiftId: c.fromShiftId,
                    date: c.date,
                    staffMemberId: c.staffMemberId,
                  }),
                );
              }}
            >
              Create &amp; move
            </Button>
          </div>
        </MiniModal>
      ) : null}

      {/* Schedule editor */}
      {editor ? (
        <ShiftScheduleEditor
          target={editor}
          saving={savingEditor}
          onClose={() => setEditor(null)}
          onSave={async (v) => {
            setSavingEditor(true);
            const nominal =
              v.startMinutes === timeToMinutes(editor.nominalStart) &&
              v.endMinutes === timeToMinutes(editor.nominalEnd) &&
              v.breakMinutes === 0;
            const r = await onSetSchedule({
              shiftId: editor.shiftId,
              staffMemberId: editor.staffMemberId,
              startMinutes: nominal ? null : v.startMinutes,
              endMinutes: nominal ? null : v.endMinutes,
              breakMinutes: v.breakMinutes,
            });
            setSavingEditor(false);
            if (r.ok) setEditor(null);
            else setToast(r.error ?? "Couldn't save the shift.");
          }}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-[10px] bg-[var(--color-ink)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_30px_rgba(17,24,39,0.3)]">
            {toast}
            <button
              type="button"
              onClick={() => setToast(null)}
              className="material-symbols-rounded text-[18px] opacity-70"
              aria-label="Dismiss"
            >
              close
            </button>
          </div>
        </div>
      ) : null}

      {pending ? (
        <span className="sr-only" role="status">
          Saving…
        </span>
      ) : null}
    </div>
  );
}

function StaffRow({
  member,
  days,
  assignmentsByDate,
  shiftById,
  leaveSet,
  canEdit,
  schemeFor,
  onOpenEditor,
  onAccept,
  onClear,
}: {
  member: BoardStaff;
  days: string[];
  assignmentsByDate: Map<string, BoardAssignment[]>;
  shiftById: Map<string, BoardShift>;
  leaveSet: Set<string>;
  canEdit: boolean;
  schemeFor: (
    s: BoardShift,
    staffId: string,
  ) => { bg: string; bar: string; text: string };
  onOpenEditor: (a: BoardAssignment) => void;
  onAccept: (shiftId: string) => void;
  onClear: (shiftId: string) => void;
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
        <StaffCell
          key={`${member.id}-${d}`}
          staffMemberId={member.id}
          date={d}
          assignments={assignmentsByDate.get(d) ?? []}
          shiftById={shiftById}
          onLeave={leaveSet.has(`${member.id}:${d}`)}
          canEdit={canEdit}
          schemeFor={schemeFor}
          onOpenEditor={onOpenEditor}
          onAccept={onAccept}
          onClear={onClear}
        />
      ))}
    </>
  );
}

function StaffCell({
  staffMemberId,
  date,
  assignments,
  shiftById,
  onLeave,
  canEdit,
  schemeFor,
  onOpenEditor,
  onAccept,
  onClear,
}: {
  staffMemberId: string;
  date: string;
  assignments: BoardAssignment[];
  shiftById: Map<string, BoardShift>;
  onLeave: boolean;
  canEdit: boolean;
  schemeFor: (
    s: BoardShift,
    staffId: string,
  ) => { bg: string; bar: string; text: string };
  onOpenEditor: (a: BoardAssignment) => void;
  onAccept: (shiftId: string) => void;
  onClear: (shiftId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${staffMemberId}:${date}`,
    data: { kind: "cell", staffMemberId, date },
    disabled: !canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      data-cell={`${staffMemberId}:${date}`}
      className={`min-h-[80px] border-b border-r border-[var(--color-border-subtle)] p-[5px] ${
        isOver
          ? "bg-[#F0F6E2] ring-2 ring-inset ring-[var(--color-accent)]"
          : "bg-white"
      }`}
    >
      {assignments.length > 0 ? (
        assignments.map((a) => {
          const s = shiftById.get(a.shiftId);
          if (!s) return null;
          return (
            <DraggableChip
              key={a.shiftId}
              a={a}
              shift={s}
              scheme={schemeFor(s, staffMemberId)}
              canEdit={canEdit}
              onOpenEditor={onOpenEditor}
              onAccept={onAccept}
              onClear={onClear}
            />
          );
        })
      ) : onLeave ? (
        <div
          className="flex min-h-[68px] flex-col justify-center rounded-[8px] border border-[#EAECEF] px-[9px] py-2"
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
        <div className="flex h-full min-h-[68px] items-center justify-center rounded-[8px] text-[20px] text-[#E2E5EA]">
          +
        </div>
      )}
    </div>
  );
}

function DraggableChip({
  a,
  shift,
  scheme,
  canEdit,
  onOpenEditor,
  onAccept,
  onClear,
}: {
  a: BoardAssignment;
  shift: BoardShift;
  scheme: { bg: string; bar: string; text: string };
  canEdit: boolean;
  onOpenEditor: (a: BoardAssignment) => void;
  onAccept: (shiftId: string) => void;
  onClear: (shiftId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `a:${a.shiftId}:${a.staffMemberId}`,
    data: {
      kind: "assignment",
      shiftId: a.shiftId,
      staffMemberId: a.staffMemberId,
    },
    disabled: !canEdit,
  });
  const suggested = a.status === "suggested";
  return (
    <div
      ref={setNodeRef}
      className={`group relative mb-1 ${isDragging ? "opacity-30" : ""}`}
      {...attributes}
    >
      <button
        type="button"
        onClick={() => canEdit && onOpenEditor(a)}
        className="block w-full text-left"
        {...listeners}
      >
        <ChipBody a={a} shift={shift} scheme={scheme} suggested={suggested} />
      </button>
      {canEdit && suggested ? (
        <div className="absolute right-1 top-1 flex gap-1">
          <button
            type="button"
            aria-label="Accept suggestion"
            onClick={(e) => {
              e.stopPropagation();
              onAccept(a.shiftId);
            }}
            className="material-symbols-rounded flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[var(--color-accent)] text-[13px] text-white"
          >
            check
          </button>
          <button
            type="button"
            aria-label="Clear suggestion"
            onClick={(e) => {
              e.stopPropagation();
              onClear(a.shiftId);
            }}
            className="material-symbols-rounded flex h-[20px] w-[20px] items-center justify-center rounded-full bg-white text-[13px] text-[var(--color-text-muted)] shadow"
          >
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChipBody({
  a,
  shift,
  scheme,
  suggested,
  dragging,
}: {
  a: BoardAssignment;
  shift: BoardShift;
  scheme: { bg: string; bar: string; text: string };
  suggested?: boolean;
  dragging?: boolean;
}) {
  const r = resolveSchedule(a, shift);
  const startMin = timeToMinutes(r.start);
  const endMin = timeToMinutes(r.end);
  const win = BAR_END - BAR_START;
  const left = Math.max(0, ((startMin - BAR_START) / win) * 100);
  const width = Math.max(4, ((endMin - startMin) / win) * 100);
  const breakLeft = r.breakMinutes
    ? ((startMin + (endMin - startMin) / 2 - r.breakMinutes / 2 - BAR_START) /
        win) *
      100
    : 0;
  const breakW = (r.breakMinutes / win) * 100;
  return (
    <div
      className={`min-h-[68px] rounded-[8px] px-[9px] py-2 ${
        suggested ? "border-[1.5px] border-dashed" : ""
      } ${dragging ? "shadow-[0_10px_28px_rgba(17,24,39,0.25)]" : ""}`}
      style={{
        backgroundColor: scheme.bg,
        borderLeft: `3px solid ${scheme.bar}`,
        ...(suggested ? { borderColor: scheme.bar } : {}),
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="font-archivo text-[12px] font-bold tracking-[0.01em]"
          style={{ color: scheme.text }}
        >
          {shift.label}
        </span>
        {suggested ? (
          <span className="rounded bg-[var(--color-brand)] px-1 py-0.5 text-[9px] font-bold text-[var(--color-brand-ink)]">
            Suggested
          </span>
        ) : r.custom ? (
          <span
            className="material-symbols-rounded text-[13px]"
            style={{ color: scheme.bar }}
            title="Custom hours"
          >
            schedule
          </span>
        ) : null}
      </div>
      <div
        className="mt-0.5 text-[11px] font-medium"
        style={{ color: scheme.text, opacity: 0.85 }}
      >
        {formatTimeOnly(r.start)} – {formatTimeOnly(r.end)}
        {r.breakMinutes ? ` · ${formatDuration(r.netMinutes)}` : ""}
      </div>
      {/* Proportional coloured span bar (the "length of time" cue). */}
      <div className="relative mt-1.5 h-[7px] rounded-full bg-[rgba(17,24,39,0.06)]">
        <span
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            background: `linear-gradient(90deg, ${scheme.bar}D9, ${scheme.bar}99)`,
          }}
        />
        {r.breakMinutes ? (
          <span
            className="absolute top-0 h-full rounded-full bg-white"
            style={{ left: `${breakLeft}%`, width: `${breakW}%`, opacity: 0.9 }}
          />
        ) : null}
      </div>
    </div>
  );
}

function OpenCell({
  date,
  shifts,
  canEdit,
}: {
  date: string;
  shifts: BoardShift[];
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `open:${date}`,
    data: { kind: "openrow", date },
    disabled: !canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      data-openrow={date}
      className={`border-r border-t border-[var(--color-border)] p-[5px] ${
        isOver
          ? "bg-[#FDECEC] ring-2 ring-inset ring-[var(--color-danger-strong,#DC2626)]"
          : "bg-[#FCFCFB]"
      }`}
    >
      {shifts.length === 0 ? (
        <div className="min-h-[62px]" />
      ) : (
        shifts.map((s) => (
          <DraggableOpenChip key={s.id} shift={s} canEdit={canEdit} />
        ))
      )}
    </div>
  );
}

function DraggableOpenChip({
  shift,
  canEdit,
}: {
  shift: BoardShift;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `o:${shift.id}`,
    data: { kind: "open", shiftId: shift.id, date: shift.date },
    disabled: !canEdit,
  });
  const scheme = resolveShiftColors(shift.color, shift.label);
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? "opacity-30" : ""}
      {...attributes}
      {...listeners}
    >
      <OpenChip shift={shift} scheme={scheme} />
    </div>
  );
}

function OpenChip({
  shift,
  scheme,
  dragging,
}: {
  shift: BoardShift;
  scheme: { bg: string; bar: string; text: string };
  dragging?: boolean;
}) {
  return (
    <div
      className={`mb-1 flex min-h-[62px] flex-col gap-0.5 rounded-[8px] border-[1.5px] border-dashed border-[#CBD5E1] px-[9px] py-2 ${
        dragging ? "shadow-[0_10px_28px_rgba(17,24,39,0.25)]" : ""
      }`}
      style={{
        background:
          "repeating-linear-gradient(135deg,#fff,#fff 9px,#FAFBFC 9px,#FAFBFC 18px)",
        borderLeftColor: scheme.bar,
      }}
    >
      <div className="font-archivo text-[12px] font-bold text-[#475569]">
        Open · {shift.label}
      </div>
      <div className="text-[11px] text-[#94A3B8]">
        {formatTimeOnly(shift.startTime)} – {formatTimeOnly(shift.endTime)}
      </div>
      <div className="mt-auto text-[10.5px] font-bold text-[#4D7C0F]">
        Drag onto a name
      </div>
    </div>
  );
}

function MiniModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[400px] rounded-[16px] bg-white p-5 shadow-[0_22px_52px_rgba(17,24,39,0.24)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-archivo text-[16px] font-extrabold text-[var(--color-ink)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="material-symbols-rounded text-[20px] text-[var(--color-text-muted)]"
          >
            close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
