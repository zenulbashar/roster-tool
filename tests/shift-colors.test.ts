import { describe, it, expect } from "vitest";
import {
  shiftSchemeOf,
  shiftColorScheme,
  resolveShiftColors,
  SHIFT_PALETTE,
  SHIFT_COLOR_VALUES,
  type ShiftScheme,
} from "@/lib/shift-colors";

describe("shiftSchemeOf", () => {
  const cases: [string, ShiftScheme][] = [
    // morning family
    ["Morning", "morning"],
    ["Open", "morning"],
    ["Early bird", "morning"],
    ["AM", "morning"],
    ["7am Open", "morning"],
    // arvo family
    ["Afternoon", "arvo"],
    ["Arvo", "arvo"],
    ["Mid", "arvo"],
    ["PM", "arvo"],
    // close family
    ["Close", "close"],
    ["Closing", "close"],
    ["Late", "close"],
    ["Night", "close"],
    // split family
    ["Split", "split"],
    ["Broken shift", "split"],
    // default
    ["Brunch", "default"],
    ["Delivery run", "default"],
    ["", "default"],
  ];

  it.each(cases)("maps %j to the %s scheme", (name, scheme) => {
    expect(shiftSchemeOf(name)).toBe(scheme);
  });

  it("matches am/pm only as standalone tokens, not inside words", () => {
    // "Team" contains "am" but must not resolve to morning.
    expect(shiftSchemeOf("Team meeting")).toBe("default");
    // "Campaign" contains "pm"/"am" substrings but must not resolve to arvo.
    expect(shiftSchemeOf("Campaign")).toBe("default");
  });

  it("is case-insensitive", () => {
    expect(shiftSchemeOf("mOrNiNg")).toBe("morning");
  });

  it("prefers split over other keywords when both appear", () => {
    expect(shiftSchemeOf("Split close")).toBe("split");
  });
});

describe("shiftColorScheme", () => {
  it("returns the bg/bar/text triple for a scheme", () => {
    expect(shiftColorScheme("Morning")).toEqual({
      bg: "#F4F8E9",
      bar: "#76b900",
      text: "#3F6212",
    });
  });

  it("returns the default scheme for an unrecognised name", () => {
    expect(shiftColorScheme("Brunch")).toEqual({
      bg: "#F0F9FF",
      bar: "#0EA5E9",
      text: "#075985",
    });
  });
});

describe("resolveShiftColors", () => {
  it("uses an explicit palette colour when set (wins over the name)", () => {
    const purple = SHIFT_PALETTE.find((p) => p.name === "Purple")!;
    // Name would map to "morning" (green), but the stored colour wins.
    const resolved = resolveShiftColors(purple.bar, "Morning");
    expect(resolved).toEqual({
      bg: purple.bg,
      bar: purple.bar,
      text: purple.text,
    });
  });

  it("is case-insensitive on the stored hex", () => {
    const rose = SHIFT_PALETTE.find((p) => p.name === "Rose")!;
    expect(resolveShiftColors(rose.bar.toUpperCase(), "Whatever").bar).toBe(
      rose.bar,
    );
  });

  it("falls back to the keyword scheme when colour is null/empty/unknown", () => {
    const keyword = shiftColorScheme("Close");
    expect(resolveShiftColors(null, "Close")).toEqual(keyword);
    expect(resolveShiftColors("", "Close")).toEqual(keyword);
    expect(resolveShiftColors("#123456", "Close")).toEqual(keyword);
  });

  it("exposes every palette bar hex as an accepted stored value", () => {
    for (const p of SHIFT_PALETTE) {
      expect(SHIFT_COLOR_VALUES).toContain(p.bar);
    }
  });
});
