import { describe, it, expect } from "vitest";
import {
  BOARD_SCREEN_READER_INSTRUCTIONS,
  announceCancel,
  announceEnd,
  announceOver,
  announceStart,
  directionForKey,
  droppableId,
  homeTarget,
  nextBoardTarget,
  parseDraggableId,
  parseDroppableId,
  speakDate,
  type BoardGrid,
  type BoardSpeech,
} from "@/lib/board-keyboard";

/**
 * UX-02: the roster board's keyboard operation is a LOGICAL walk over the
 * (person, day) grid, and every step/drop is spoken. These pin the walk's
 * edges and the wording a screen-reader user hears.
 */

const days = ["2026-06-08", "2026-06-09", "2026-06-10"];
const staffIds = ["ava", "ben", "cam"];

const shifts = {
  s1: {
    label: "Morning",
    date: "2026-06-08",
    startTime: "08:00",
    endTime: "16:00",
  },
  s2: {
    label: "Morning",
    date: "2026-06-09",
    startTime: "08:00",
    endTime: "16:00",
  },
  s3: {
    label: "Close",
    date: "2026-06-09",
    startTime: "18:00",
    endTime: "02:00",
  },
} as const;

const ctx: BoardSpeech = {
  shift: (id) => shifts[id as keyof typeof shifts],
  staffName: (id) => ({ ava: "Ava Jones", ben: "Ben", cam: "Cam Hess" })[id],
  availability: (shiftId, staffId) =>
    staffId === "ben" ? "yes" : staffId === "cam" ? "no" : "unknown",
  onLeave: (staffId, date) => staffId === "cam" && date === "2026-06-10",
  matchingShiftOn: (shiftId, date) =>
    shiftId === "s1" && date === "2026-06-09"
      ? { id: "s2", ...shifts.s2 }
      : null,
};

describe("id parsing", () => {
  it("round-trips the board's draggable and droppable ids", () => {
    expect(parseDraggableId("a:s1:ava")).toEqual({
      kind: "assignment",
      shiftId: "s1",
      staffId: "ava",
    });
    expect(parseDraggableId("o:s3")).toEqual({ kind: "open", shiftId: "s3" });
    expect(parseDraggableId("x:1")).toBeNull();
    expect(parseDraggableId("a:s1")).toBeNull();

    expect(parseDroppableId("cell:ben:2026-06-09")).toEqual({
      kind: "cell",
      staffId: "ben",
      date: "2026-06-09",
    });
    expect(parseDroppableId("open:2026-06-09")).toEqual({
      kind: "open",
      date: "2026-06-09",
    });
    expect(parseDroppableId("oblock:s3")).toEqual({
      kind: "oblock",
      shiftId: "s3",
    });
    expect(parseDroppableId("nope")).toBeNull();

    expect(
      droppableId({ kind: "cell", staffId: "ben", date: "2026-06-09" }),
    ).toBe("cell:ben:2026-06-09");
    expect(droppableId({ kind: "open", date: "2026-06-09" })).toBe(
      "open:2026-06-09",
    );
  });

  it("maps arrow keys to directions and nothing else", () => {
    expect(directionForKey("ArrowUp")).toBe("up");
    expect(directionForKey("ArrowDown")).toBe("down");
    expect(directionForKey("ArrowLeft")).toBe("left");
    expect(directionForKey("ArrowRight")).toBe("right");
    expect(directionForKey("Space")).toBeNull();
    expect(directionForKey("KeyA")).toBeNull();
  });

  it("starts a drag from the chip's own cell or the open block's day", () => {
    const shiftDate = (id: string) => ctx.shift(id)?.date;
    expect(
      homeTarget(
        { kind: "assignment", shiftId: "s1", staffId: "ava" },
        shiftDate,
      ),
    ).toEqual({ kind: "cell", staffId: "ava", date: "2026-06-08" });
    expect(homeTarget({ kind: "open", shiftId: "s3" }, shiftDate)).toEqual({
      kind: "open",
      date: "2026-06-09",
    });
    expect(
      homeTarget({ kind: "open", shiftId: "missing" }, shiftDate),
    ).toBeNull();
  });
});

describe("nextBoardTarget (one arrow press)", () => {
  const grid: BoardGrid = { staffIds, days, allowOpenRow: true };
  const at = (staffId: string, date: string) =>
    ({ kind: "cell", staffId, date }) as const;

  it("moves along the row and down the column", () => {
    expect(nextBoardTarget(at("ava", days[0]!), "right", grid)).toEqual(
      at("ava", days[1]!),
    );
    expect(nextBoardTarget(at("ava", days[1]!), "left", grid)).toEqual(
      at("ava", days[0]!),
    );
    expect(nextBoardTarget(at("ava", days[1]!), "down", grid)).toEqual(
      at("ben", days[1]!),
    );
    expect(nextBoardTarget(at("ben", days[1]!), "up", grid)).toEqual(
      at("ava", days[1]!),
    );
  });

  it("never wraps at an edge", () => {
    expect(nextBoardTarget(at("ava", days[0]!), "left", grid)).toBeNull();
    expect(nextBoardTarget(at("ava", days[2]!), "right", grid)).toBeNull();
    expect(nextBoardTarget(at("ava", days[0]!), "up", grid)).toBeNull();
  });

  it("reaches the Open row below the last person for an assignment, and comes back up", () => {
    expect(nextBoardTarget(at("cam", days[1]!), "down", grid)).toEqual({
      kind: "open",
      date: days[1],
    });
    expect(
      nextBoardTarget({ kind: "open", date: days[1]! }, "down", grid),
    ).toBeNull();
    expect(
      nextBoardTarget({ kind: "open", date: days[1]! }, "up", grid),
    ).toEqual(at("cam", days[1]!));
    // Along the Open row is fine for an assignment (unassign on another day).
    expect(
      nextBoardTarget({ kind: "open", date: days[1]! }, "right", grid),
    ).toEqual({ kind: "open", date: days[2] });
  });

  it("keeps an OPEN block off the Open row (dropping it there does nothing)", () => {
    const openGrid: BoardGrid = { ...grid, allowOpenRow: false };
    // From its home on the Open row, only Up leads anywhere.
    expect(
      nextBoardTarget({ kind: "open", date: days[1]! }, "up", openGrid),
    ).toEqual(at("cam", days[1]!));
    expect(
      nextBoardTarget({ kind: "open", date: days[1]! }, "right", openGrid),
    ).toBeNull();
    expect(
      nextBoardTarget({ kind: "open", date: days[1]! }, "down", openGrid),
    ).toBeNull();
    // And the last person's row is the floor.
    expect(nextBoardTarget(at("cam", days[1]!), "down", openGrid)).toBeNull();
  });

  it("returns null for a position that isn't on the board", () => {
    expect(nextBoardTarget(at("zed", days[0]!), "right", grid)).toBeNull();
    expect(nextBoardTarget(at("ava", "2030-01-01"), "right", grid)).toBeNull();
  });
});

describe("speech", () => {
  it("speaks calendar dates in full", () => {
    expect(speakDate("2026-06-09")).toBe("Tuesday 9 June");
    expect(speakDate("2026-12-25")).toBe("Friday 25 December");
    expect(speakDate("garbage")).toBe("garbage");
  });

  it("announces the pick-up with who, what, when and how to move", () => {
    const text = announceStart("a:s1:ava", ctx);
    expect(text).toContain(
      "Picked up Ava Jones' Morning shift on Monday 8 June, 8 am – 4 pm",
    );
    expect(text).toContain("arrow keys");
    expect(text).toContain("Open shifts row");
    expect(text).toContain("Escape to cancel");
    expect(announceStart("o:s3", ctx)).toContain(
      "Picked up the open Close shift on Tuesday 9 June, 6 pm – 2 am (next day)",
    );
    expect(announceStart("bogus", ctx)).toBe("Picked up a shift.");
  });

  it("says what a drop WOULD do while hovering, with availability and leave", () => {
    // Another person, same day: the same shift changes hands.
    expect(announceOver("a:s1:ava", "cell:ben:2026-06-08", ctx)).toBe(
      "Over Ben, Monday 8 June. Dropping moves the shift to Ben. Ben said they can work it.",
    );
    // Another day with a matching block.
    expect(announceOver("a:s1:ava", "cell:cam:2026-06-09", ctx)).toBe(
      "Over Cam Hess, Tuesday 9 June. Dropping moves the shift to Cam Hess. Cam Hess said they can't work it.",
    );
    // A day with no matching block: the server clones one.
    expect(announceOver("a:s1:ava", "cell:ava:2026-06-10", ctx)).toBe(
      "Over Ava Jones, Wednesday 10 June. Dropping moves the shift to Ava Jones. There is no Morning shift that day yet — dropping creates one.",
    );
    // Leave outranks the availability reply.
    expect(announceOver("a:s1:ava", "cell:cam:2026-06-10", ctx)).toContain(
      "Cam Hess is on approved leave that day.",
    );
    // Home cell: nothing would change.
    expect(announceOver("a:s1:ava", "cell:ava:2026-06-08", ctx)).toContain(
      "This is where it started",
    );
    // The Open row unassigns.
    expect(announceOver("a:s1:ava", "open:2026-06-08", ctx)).toBe(
      "Over Open shifts, Monday 8 June. Dropping here removes Ava Jones from the shift and leaves it open.",
    );
    // Open block → person assigns.
    expect(announceOver("o:s3", "cell:ben:2026-06-09", ctx)).toBe(
      "Over Ben, Tuesday 9 June. Dropping assigns Ben to Close. Ben said they can work it.",
    );
    expect(announceOver("o:s3", "open:2026-06-09", ctx)).toContain(
      "changes nothing",
    );
    // Pointer-only: hovering a specific open block.
    expect(announceOver("a:s1:ava", "oblock:s3", ctx)).toBe(
      "Over the open Close shift on Tuesday 9 June, 6 pm – 2 am (next day). Dropping moves Ava Jones onto it.",
    );
    expect(announceOver("a:s1:ava", null, ctx)).toBe(
      "Not over a day or person. Dropping here changes nothing.",
    );
  });

  it("announces the drop and the cancel", () => {
    expect(announceEnd("a:s1:ava", "cell:ben:2026-06-08", ctx)).toBe(
      "Dropped on Ben, Monday 8 June. Saving.",
    );
    expect(announceEnd("a:s1:ava", "cell:ava:2026-06-08", ctx)).toBe(
      "Dropped back where it was. Nothing changed.",
    );
    expect(announceEnd("a:s1:ava", "open:2026-06-08", ctx)).toBe(
      "Dropped on Open shifts, Monday 8 June. Removing them from the shift.",
    );
    expect(announceEnd("o:s3", "open:2026-06-09", ctx)).toBe(
      "Dropped on Open shifts. Nothing changed.",
    );
    expect(announceEnd("a:s1:ava", "oblock:s3", ctx)).toBe(
      "Dropped on the open Close shift, Tuesday 9 June. Saving.",
    );
    expect(announceEnd("a:s1:ava", null, ctx)).toBe(
      "Dropped back where it was. Nothing changed.",
    );
    expect(announceCancel("a:s1:ava", ctx)).toBe(
      "Move cancelled. Ava Jones' Morning shift on Monday 8 June, 8 am – 4 pm stays where it was.",
    );
  });

  it("tells the keyboard user the whole gesture up front", () => {
    for (const phrase of [
      "Space or Enter",
      "arrow keys",
      "Open shifts row",
      "Escape",
    ]) {
      expect(BOARD_SCREEN_READER_INSTRUCTIONS).toContain(phrase);
    }
  });
});
