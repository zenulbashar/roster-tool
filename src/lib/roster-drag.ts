/**
 * Pure drag-and-drop domain logic for the roster builder: when a staff member's
 * shift chip is dragged onto another day, decide which shift on that day it
 * lands on. Kept separate from React so it is trivially unit-testable and the
 * client island and server action agree on the rule.
 */

export type ShiftOnDay = {
  id: string;
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
};

export type DraggedShift = {
  templateId: string | null;
  label: string;
  startTime: string;
  endTime: string;
};

export type TargetResolution =
  /** Exactly one matching shift exists that day — assign straight there. */
  | { kind: "assign"; shiftId: string }
  /** Several matching shifts — the owner must pick which one. */
  | { kind: "choose"; shiftIds: string[] }
  /** No shift of this type that day — offer to create one and assign. */
  | { kind: "create" };

function norm(label: string): string {
  return label.trim().toLowerCase();
}

/** Two shifts are "the same type" by template id, or (when either has no
 * template — e.g. its type was deleted) by matching label + start/end. */
function sameType(a: DraggedShift, b: ShiftOnDay): boolean {
  if (a.templateId && b.templateId) return a.templateId === b.templateId;
  return (
    norm(a.label) === norm(b.label) &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime
  );
}

/**
 * Resolve where a dragged chip should land among the shifts already on the
 * target day. Prefers a same-type match; falls back to offering to create the
 * shift on that day. `excludeShiftId` is the chip's origin shift (so dragging
 * within the same day doesn't match itself).
 */
export function chooseTargetShift(
  dragged: DraggedShift,
  shiftsOnDay: ShiftOnDay[],
  excludeShiftId?: string,
): TargetResolution {
  const matches = shiftsOnDay.filter(
    (s) => s.id !== excludeShiftId && sameType(dragged, s),
  );
  if (matches.length === 1) return { kind: "assign", shiftId: matches[0]!.id };
  if (matches.length > 1) {
    return { kind: "choose", shiftIds: matches.map((s) => s.id) };
  }
  return { kind: "create" };
}
