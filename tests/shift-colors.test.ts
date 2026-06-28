import { describe, it, expect } from "vitest";
import {
  shiftSchemeOf,
  shiftColorScheme,
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
