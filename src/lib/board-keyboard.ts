import { formatTimeRange } from "@/lib/time";

/**
 * Keyboard operation + spoken announcements for the drag-and-drop roster
 * board (UX-02 / WCAG 2.1.1). Pure: the board component adapts these to
 * dnd-kit's KeyboardSensor coordinate getter and `accessibility` prop.
 *
 * The board's droppable ids are the grid coordinates already:
 *   cell:<staffId>:<date>   a person's day cell
 *   open:<date>             the Open shifts row for that day (drop = unassign)
 *   oblock:<shiftId>        one open block inside the Open row (pointer only)
 * and its draggable ids name what is being moved:
 *   a:<shiftId>:<staffId>   a person's assignment chip
 *   o:<shiftId>             an open (unfilled) shift block
 * So keyboard navigation is a LOGICAL walk over (row, column) — never a
 * geometric "nearest rect in that direction" guess — which makes every arrow
 * press land on exactly one cell and lets the announcements say where.
 */

export type BoardDirection = "up" | "down" | "left" | "right";

export type BoardTarget =
  | { kind: "cell"; staffId: string; date: string }
  | { kind: "open"; date: string };

export type BoardDropTarget = BoardTarget | { kind: "oblock"; shiftId: string };

export type BoardSource =
  | { kind: "assignment"; shiftId: string; staffId: string }
  | { kind: "open"; shiftId: string };

/** Arrow key → grid direction; anything else is not a move key. */
export function directionForKey(code: string): BoardDirection | null {
  switch (code) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

export function parseDraggableId(id: string): BoardSource | null {
  const parts = id.split(":");
  if (parts[0] === "a" && parts.length === 3 && parts[1] && parts[2]) {
    return { kind: "assignment", shiftId: parts[1], staffId: parts[2] };
  }
  if (parts[0] === "o" && parts.length === 2 && parts[1]) {
    return { kind: "open", shiftId: parts[1] };
  }
  return null;
}

export function parseDroppableId(id: string): BoardDropTarget | null {
  const parts = id.split(":");
  if (parts[0] === "cell" && parts.length === 3 && parts[1] && parts[2]) {
    return { kind: "cell", staffId: parts[1], date: parts[2] };
  }
  if (parts[0] === "open" && parts.length === 2 && parts[1]) {
    return { kind: "open", date: parts[1] };
  }
  if (parts[0] === "oblock" && parts.length === 2 && parts[1]) {
    return { kind: "oblock", shiftId: parts[1] };
  }
  return null;
}

export function droppableId(target: BoardTarget): string {
  return target.kind === "cell"
    ? `cell:${target.staffId}:${target.date}`
    : `open:${target.date}`;
}

/** Where a drag starts: the chip's own cell, or the open block's day. */
export function homeTarget(
  source: BoardSource,
  shiftDate: (shiftId: string) => string | undefined,
): BoardTarget | null {
  const date = shiftDate(source.shiftId);
  if (!date) return null;
  return source.kind === "assignment"
    ? { kind: "cell", staffId: source.staffId, date }
    : { kind: "open", date };
}

export type BoardGrid = {
  /** Staff rows, top to bottom (the board's render order). */
  staffIds: string[];
  /** Day columns, left to right. */
  days: string[];
  /**
   * Whether the Open shifts row (below the last person) is a valid stop.
   * True for an assignment chip (dropping there unassigns); false for an open
   * block (dropping an open shift on the Open row does nothing).
   */
  allowOpenRow: boolean;
};

/**
 * One arrow press: the neighbouring cell in that direction, or null at an
 * edge (no wrap-around — a keyboard user should never be surprised by a jump
 * to the far side of the board). Rows are people in order, then the Open
 * row; columns are the days.
 */
export function nextBoardTarget(
  from: BoardTarget,
  direction: BoardDirection,
  grid: BoardGrid,
): BoardTarget | null {
  const col = grid.days.indexOf(from.date);
  if (col < 0) return null;
  const openRow = grid.staffIds.length;
  const row =
    from.kind === "cell" ? grid.staffIds.indexOf(from.staffId) : openRow;
  if (row < 0) return null;

  let nextRow = row;
  let nextCol = col;
  switch (direction) {
    case "left":
      nextCol -= 1;
      break;
    case "right":
      nextCol += 1;
      break;
    case "up":
      nextRow -= 1;
      break;
    case "down":
      nextRow += 1;
      break;
  }
  if (nextCol < 0 || nextCol >= grid.days.length) return null;
  if (nextRow < 0) return null;
  const lastRow = grid.allowOpenRow ? openRow : openRow - 1;
  if (nextRow > lastRow) return null;

  const date = grid.days[nextCol]!;
  if (nextRow === openRow) return { kind: "open", date };
  return { kind: "cell", staffId: grid.staffIds[nextRow]!, date };
}

/* ------------------------------ speech ----------------------------------- */

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-06-09" → "Tuesday 9 June" — for speech, where "Tue 09/06" reads badly. */
export function speakDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  return `${WEEKDAY_LONG[d.getUTCDay()]} ${day} ${MONTH_LONG[month - 1]}`;
}

/** What the announcer needs to know about the board — lookups, not React. */
export type BoardSpeech = {
  shift: (
    shiftId: string,
  ) =>
    | { label: string; date: string; startTime: string; endTime: string }
    | undefined;
  staffName: (staffId: string) => string | undefined;
  availability: (shiftId: string, staffId: string) => "yes" | "no" | "unknown";
  onLeave: (staffId: string, date: string) => boolean;
  /**
   * The block a drop on `date` would land the dragged shift on (the same
   * shift for its own day, else that day's matching block), or null when the
   * day has none — the server would clone one.
   */
  matchingShiftOn: (
    shiftId: string,
    date: string,
  ) => { id: string; label: string; startTime: string; endTime: string } | null;
};

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** "Ava's Morning shift on Monday 8 June, 8 am – 4 pm" / "the open Close shift on …". */
export function describeSource(source: BoardSource, ctx: BoardSpeech): string {
  const shift = ctx.shift(source.shiftId);
  if (!shift) return "this shift";
  const when = `${speakDate(shift.date)}, ${formatTimeRange(shift.startTime, shift.endTime)}`;
  if (source.kind === "assignment") {
    const name = ctx.staffName(source.staffId) ?? "This person";
    return `${possessive(name)} ${shift.label} shift on ${when}`;
  }
  return `the open ${shift.label} shift on ${when}`;
}

function availabilityNote(
  ctx: BoardSpeech,
  shiftId: string | null,
  staffId: string,
  date: string,
): string {
  const name = ctx.staffName(staffId) ?? "They";
  if (ctx.onLeave(staffId, date))
    return ` ${name} is on approved leave that day.`;
  if (!shiftId) return "";
  const avail = ctx.availability(shiftId, staffId);
  if (avail === "yes") return ` ${name} said they can work it.`;
  if (avail === "no") return ` ${name} said they can't work it.`;
  return "";
}

export function announceStart(activeId: string, ctx: BoardSpeech): string {
  const source = parseDraggableId(activeId);
  if (!source) return "Picked up a shift.";
  const what = describeSource(source, ctx);
  const how =
    source.kind === "assignment"
      ? "Use the arrow keys to move it to another day or person, or down to the Open shifts row to remove them from it."
      : "Use the arrow keys to move it onto a person.";
  return `Picked up ${what}. ${how} Press Space or Enter to drop, Escape to cancel.`;
}

/** What dropping `activeId` on `overId` would do — spoken while hovering. */
export function announceOver(
  activeId: string,
  overId: string | null,
  ctx: BoardSpeech,
): string {
  const source = parseDraggableId(activeId);
  if (!source) return "";
  const target = overId ? parseDroppableId(overId) : null;
  if (!target)
    return "Not over a day or person. Dropping here changes nothing.";
  const shift = ctx.shift(source.shiftId);
  if (!shift) return "";

  if (target.kind === "cell") {
    const name = ctx.staffName(target.staffId) ?? "someone";
    const where = `${name}, ${speakDate(target.date)}`;
    if (
      source.kind === "assignment" &&
      target.staffId === source.staffId &&
      target.date === shift.date
    ) {
      return `Over ${where}. This is where it started — dropping here changes nothing.`;
    }
    const block =
      target.date === shift.date
        ? { id: source.shiftId }
        : ctx.matchingShiftOn(source.shiftId, target.date);
    const note = availabilityNote(
      ctx,
      block?.id ?? null,
      target.staffId,
      target.date,
    );
    if (source.kind === "assignment") {
      const clone = block
        ? ""
        : ` There is no ${shift.label} shift that day yet — dropping creates one.`;
      return `Over ${where}. Dropping moves the shift to ${name}.${clone}${note}`;
    }
    const clone = block
      ? ""
      : ` There is no ${shift.label} shift that day yet — dropping creates one.`;
    return `Over ${where}. Dropping assigns ${name} to ${shift.label}.${clone}${note}`;
  }

  if (target.kind === "open") {
    if (source.kind === "assignment") {
      const name = ctx.staffName(source.staffId) ?? "them";
      return `Over Open shifts, ${speakDate(target.date)}. Dropping here removes ${name} from the shift and leaves it open.`;
    }
    return `Over Open shifts, ${speakDate(target.date)}. Dropping here changes nothing.`;
  }

  // An open block (pointer drags only — keyboard navigation stops at cells).
  const block = ctx.shift(target.shiftId);
  if (!block) return "";
  if (source.kind === "assignment") {
    const name = ctx.staffName(source.staffId) ?? "them";
    return `Over the open ${block.label} shift on ${speakDate(block.date)}, ${formatTimeRange(block.startTime, block.endTime)}. Dropping moves ${name} onto it.`;
  }
  return `Over the open ${block.label} shift. Dropping here changes nothing.`;
}

export function announceEnd(
  activeId: string,
  overId: string | null,
  ctx: BoardSpeech,
): string {
  const source = parseDraggableId(activeId);
  const target = overId ? parseDroppableId(overId) : null;
  if (!source || !target) return "Dropped back where it was. Nothing changed.";
  const shift = ctx.shift(source.shiftId);
  if (target.kind === "cell") {
    if (
      source.kind === "assignment" &&
      shift &&
      target.staffId === source.staffId &&
      target.date === shift.date
    ) {
      return "Dropped back where it was. Nothing changed.";
    }
    const name = ctx.staffName(target.staffId) ?? "someone";
    return `Dropped on ${name}, ${speakDate(target.date)}. Saving.`;
  }
  if (target.kind === "open") {
    return source.kind === "assignment"
      ? `Dropped on Open shifts, ${speakDate(target.date)}. Removing them from the shift.`
      : "Dropped on Open shifts. Nothing changed.";
  }
  const block = ctx.shift(target.shiftId);
  if (
    source.kind === "assignment" &&
    block &&
    target.shiftId !== source.shiftId
  ) {
    return `Dropped on the open ${block.label} shift, ${speakDate(block.date)}. Saving.`;
  }
  return "Dropped back where it was. Nothing changed.";
}

export function announceCancel(activeId: string, ctx: BoardSpeech): string {
  const source = parseDraggableId(activeId);
  if (!source) return "Move cancelled. Nothing changed.";
  return `Move cancelled. ${describeSource(source, ctx)} stays where it was.`;
}

/** The instructions dnd-kit attaches to every draggable via aria-describedby. */
export const BOARD_SCREEN_READER_INSTRUCTIONS =
  "To move this shift with the keyboard, press Space or Enter to pick it up. " +
  "Use the arrow keys to move it to another day or person; moving down past the last person reaches the Open shifts row, which removes the person from the shift. " +
  "Press Space or Enter again to drop it, or Escape to cancel.";
