"use client";

import { useEffect, useRef, useState } from "react";
import {
  BREAK_OPTIONS,
  DAY_MINUTES,
  MIN_SHIFT_MINUTES,
  SNAP_MINUTES,
  breakPlacement,
  formatDuration,
  minutesToTime,
  snapMinutes,
  timeToMinutes,
} from "@/lib/roster-schedule";
import { formatTimeOnly } from "@/lib/time";
import { Button } from "@/components/ui";

/**
 * Per-assignment timeline editor: drag the block's edges to resize the shift and
 * drop in an unpaid break. Every drag has an accessible, mobile-friendly twin
 * (stepper buttons + a break segmented control) so the editor never depends on a
 * pointer. Emits resolved minutes; the parent persists via the server action
 * (which re-validates through roster-schedule).
 *
 * Rostered times/breaks are a PLANNING AID — not a payroll calculation and never
 * enforced against clock-in.
 */

export type EditorTarget = {
  shiftId: string;
  staffMemberId: string;
  staffName: string;
  shiftLabel: string;
  /** The shift's own nominal times (the fallback + reset target). */
  nominalStart: string;
  nominalEnd: string;
  /** The resolved current block for this person. */
  start: string;
  end: string;
  breakMinutes: number;
  /** Employee colour bar hex (the block tint). */
  color: string;
};

const HOUR = 60;

function windowFor(startMin: number, nominalStartMin: number): number {
  // Show from 6am, or earlier if the block/nominal starts before then.
  return Math.min(
    6 * HOUR,
    snapDownHour(startMin),
    snapDownHour(nominalStartMin),
  );
}
function snapDownHour(min: number): number {
  return Math.floor(min / HOUR) * HOUR;
}

export function ShiftScheduleEditor({
  target,
  onClose,
  onSave,
  saving,
}: {
  target: EditorTarget;
  onClose: () => void;
  onSave: (v: {
    startMinutes: number;
    endMinutes: number;
    breakMinutes: number;
  }) => void;
  saving: boolean;
}) {
  const [start, setStart] = useState(() => timeToMinutes(target.start));
  const [end, setEnd] = useState(() => timeToMinutes(target.end));
  const [brk, setBrk] = useState(() => target.breakMinutes);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const nominalStart = timeToMinutes(target.nominalStart);
  const winStart = windowFor(
    Math.min(start, timeToMinutes(target.start)),
    nominalStart,
  );
  const winEnd = DAY_MINUTES;
  const winSpan = winEnd - winStart;

  const pct = (min: number) => ((min - winStart) / winSpan) * 100;
  const clamp = (min: number) => Math.max(winStart, Math.min(winEnd, min));

  // Keep start < end with a minimum span, and the break under the span.
  const span = Math.max(0, end - start);
  useEffect(() => {
    if (brk >= span && span > 0) setBrk(0);
  }, [span, brk]);

  const dragging = useRef<null | "start" | "end">(null);
  function pointerToMinutes(clientX: number): number {
    const el = trackRef.current;
    if (!el) return start;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return snapMinutes(winStart + ratio * winSpan);
  }
  function onHandleDown(which: "start" | "end", e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = which;
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const m = clamp(pointerToMinutes(e.clientX));
    if (dragging.current === "start") {
      setStart(Math.min(m, end - MIN_SHIFT_MINUTES));
    } else {
      setEnd(Math.max(m, start + MIN_SHIFT_MINUTES));
    }
  }
  function onHandleUp(e: React.PointerEvent) {
    dragging.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  function nudgeStart(delta: number) {
    setStart((s) =>
      Math.max(winStart, Math.min(end - MIN_SHIFT_MINUTES, s + delta)),
    );
  }
  function nudgeEnd(delta: number) {
    setEnd((e2) =>
      Math.min(winEnd, Math.max(start + MIN_SHIFT_MINUTES, e2 + delta)),
    );
  }

  const bp = breakPlacement(minutesToTime(start), minutesToTime(end), brk);
  const netMin = Math.max(0, span - brk);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${target.staffName}'s ${target.shiftLabel} shift`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-t-[18px] bg-white p-5 shadow-[0_-8px_40px_rgba(17,24,39,0.22)] sm:rounded-[18px] sm:shadow-[0_22px_52px_rgba(17,24,39,0.24)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-archivo text-[17px] font-extrabold text-[var(--color-ink)]">
              {target.staffName}
            </h2>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              {target.shiftLabel} ·{" "}
              <span className="font-semibold text-[var(--color-ink)]">
                {formatTimeOnly(minutesToTime(start))} –{" "}
                {formatTimeOnly(minutesToTime(end))}
              </span>{" "}
              · {formatDuration(netMin)} worked
              {brk > 0 ? ` (${brk}m break)` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="material-symbols-rounded text-[22px] text-[var(--color-text-muted)]"
          >
            close
          </button>
        </div>

        {/* Timeline track — drag the handles, or use the steppers below. */}
        <div className="mt-4 select-none">
          <div
            ref={trackRef}
            className="relative h-[52px] rounded-[10px] border border-[var(--color-border)] bg-[repeating-linear-gradient(90deg,#F7F8FA,#F7F8FA_calc(100%/18-1px),#EAECEF_calc(100%/18-1px),#EAECEF_calc(100%/18))]"
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
          >
            {/* The coloured block. */}
            <div
              className="absolute top-[6px] bottom-[6px] rounded-[7px]"
              style={{
                left: `${pct(start)}%`,
                width: `${pct(end) - pct(start)}%`,
                background: `linear-gradient(180deg, ${target.color}D9, ${target.color}B3)`,
              }}
            >
              {/* Break gap. */}
              {bp ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,.85),rgba(255,255,255,.85)_5px,rgba(255,255,255,.5)_5px,rgba(255,255,255,.5)_10px)]"
                  style={{
                    left: `${((bp.start - start) / span) * 100}%`,
                    width: `${(brk / span) * 100}%`,
                  }}
                />
              ) : null}
            </div>
            {/* Handles. */}
            <button
              type="button"
              aria-label="Drag shift start"
              onPointerDown={(e) => onHandleDown("start", e)}
              className="absolute top-[2px] bottom-[2px] z-10 w-[16px] -translate-x-1/2 cursor-ew-resize touch-none rounded-[6px] border border-white/70 bg-black/25"
              style={{ left: `${pct(start)}%` }}
            />
            <button
              type="button"
              aria-label="Drag shift end"
              onPointerDown={(e) => onHandleDown("end", e)}
              className="absolute top-[2px] bottom-[2px] z-10 w-[16px] -translate-x-1/2 cursor-ew-resize touch-none rounded-[6px] border border-white/70 bg-black/25"
              style={{ left: `${pct(end)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-[var(--color-text-muted)]">
            <span>{formatTimeOnly(minutesToTime(winStart))}</span>
            <span>{formatTimeOnly(minutesToTime(winEnd))}</span>
          </div>
        </div>

        {/* Steppers — the accessible / mobile twin of the drag handles. */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stepper
            label="Start"
            value={formatTimeOnly(minutesToTime(start))}
            onMinus={() => nudgeStart(-SNAP_MINUTES)}
            onPlus={() => nudgeStart(SNAP_MINUTES)}
          />
          <Stepper
            label="End"
            value={formatTimeOnly(minutesToTime(end))}
            onMinus={() => nudgeEnd(-SNAP_MINUTES)}
            onPlus={() => nudgeEnd(SNAP_MINUTES)}
          />
        </div>

        {/* Break. */}
        <div className="mt-4">
          <div className="mb-1.5 font-archivo text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--color-text-muted)]">
            Unpaid break
          </div>
          <div className="inline-flex overflow-hidden rounded-[9px] border border-[var(--color-border)]">
            {BREAK_OPTIONS.map((opt) => {
              const active = brk === opt;
              const disabled = opt >= span;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => setBrk(opt)}
                  className={`px-3.5 py-2 text-[13px] font-semibold ${
                    active
                      ? "bg-[var(--color-accent)] text-white"
                      : "bg-white text-[var(--color-ink)]"
                  } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {opt === 0 ? "None" : `${opt} min`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() =>
              onSave({
                startMinutes: nominalStart,
                endMinutes: timeToMinutes(target.nominalEnd),
                breakMinutes: 0,
              })
            }
            className="text-[13px] font-semibold text-[var(--color-brand)] underline underline-offset-2"
          >
            Reset to shift times
          </button>
          <div className="flex items-center gap-2.5">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                onSave({
                  startMinutes: start,
                  endMinutes: end,
                  breakMinutes: brk,
                })
              }
              disabled={saving || end - start < MIN_SHIFT_MINUTES}
            >
              {saving ? "Saving…" : "Save shift"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-border)] px-3 py-2">
      <div className="font-archivo text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={`${label} earlier`}
          onClick={onMinus}
          className="material-symbols-rounded flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[var(--color-border)] text-[18px] text-[var(--color-ink)]"
        >
          remove
        </button>
        <span className="font-archivo text-[15px] font-bold text-[var(--color-ink)]">
          {value}
        </span>
        <button
          type="button"
          aria-label={`${label} later`}
          onClick={onPlus}
          className="material-symbols-rounded flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[var(--color-border)] text-[18px] text-[var(--color-ink)]"
        >
          add
        </button>
      </div>
    </div>
  );
}
