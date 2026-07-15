import { describe, it, expect } from "vitest";
import { chooseTargetShift, type ShiftOnDay } from "@/lib/roster-drag";

const morningTpl = "tpl-morning";
const eveningTpl = "tpl-evening";

function shift(over: Partial<ShiftOnDay> & { id: string }): ShiftOnDay {
  return {
    templateId: morningTpl,
    label: "Morning",
    startTime: "09:00:00",
    endTime: "17:00:00",
    ...over,
  };
}

describe("chooseTargetShift", () => {
  it("assigns to the single same-template shift on the day", () => {
    const dragged = {
      templateId: morningTpl,
      label: "Morning",
      startTime: "09:00:00",
      endTime: "17:00:00",
    };
    const day = [
      shift({ id: "m1" }),
      shift({ id: "e1", templateId: eveningTpl, label: "Evening" }),
    ];
    expect(chooseTargetShift(dragged, day)).toEqual({
      kind: "assign",
      shiftId: "m1",
    });
  });

  it("asks the owner to choose when several match", () => {
    const dragged = {
      templateId: morningTpl,
      label: "Morning",
      startTime: "09:00:00",
      endTime: "17:00:00",
    };
    const day = [shift({ id: "m1" }), shift({ id: "m2" })];
    expect(chooseTargetShift(dragged, day)).toEqual({
      kind: "choose",
      shiftIds: ["m1", "m2"],
    });
  });

  it("offers to create when no shift of that type exists that day", () => {
    const dragged = {
      templateId: morningTpl,
      label: "Morning",
      startTime: "09:00:00",
      endTime: "17:00:00",
    };
    const day = [shift({ id: "e1", templateId: eveningTpl, label: "Evening" })];
    expect(chooseTargetShift(dragged, day)).toEqual({ kind: "create" });
  });

  it("excludes the origin shift so a same-day move doesn't match itself", () => {
    const dragged = {
      templateId: morningTpl,
      label: "Morning",
      startTime: "09:00:00",
      endTime: "17:00:00",
    };
    const day = [shift({ id: "m1" })];
    expect(chooseTargetShift(dragged, day, "m1")).toEqual({ kind: "create" });
  });

  it("matches on label+times when a template was deleted (null templateId)", () => {
    const dragged = {
      templateId: null,
      label: "morning", // case-insensitive
      startTime: "09:00:00",
      endTime: "17:00:00",
    };
    const day = [shift({ id: "m1", templateId: null })];
    expect(chooseTargetShift(dragged, day)).toEqual({
      kind: "assign",
      shiftId: "m1",
    });
  });

  it("does not match a same-label shift with different times", () => {
    const dragged = {
      templateId: null,
      label: "Morning",
      startTime: "09:00:00",
      endTime: "17:00:00",
    };
    const day = [shift({ id: "m1", templateId: null, endTime: "13:00:00" })];
    expect(chooseTargetShift(dragged, day)).toEqual({ kind: "create" });
  });
});
