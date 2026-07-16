import { describe, expect, it } from "vitest";
import {
  dayStaffOverridesSchema,
  dayTimeOverridesSchema,
  templateSchema,
} from "@/lib/validation";

/**
 * Pins the PARTIAL parse of the per-weekday override maps. zod v4 makes
 * enum-keyed z.record EXHAUSTIVE (all seven weekdays required), which
 * silently rejected the normal "only Friday differs" map — both schemas must
 * use z.partialRecord. Regression coverage for that fix.
 */
describe("per-weekday override schemas accept partial maps", () => {
  it("time overrides: a single-day map parses", () => {
    const r = dayTimeOverridesSchema.safeParse({
      "5": { start: "10:00", end: "12:00" },
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({
      "5": { start: "10:00", end: "12:00" },
    });
  });

  it("staff overrides: a single-day map parses and coerces form strings", () => {
    const r = dayStaffOverridesSchema.safeParse({ "5": "4" });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ "5": 4 });
  });

  it("empty/absent maps normalise to null; bad keys and values reject", () => {
    expect(dayStaffOverridesSchema.parse({})).toBeNull();
    expect(dayStaffOverridesSchema.parse(undefined)).toBeNull();
    expect(dayStaffOverridesSchema.safeParse({ "8": 2 }).success).toBe(false);
    expect(dayStaffOverridesSchema.safeParse({ "5": 0 }).success).toBe(false);
    expect(dayStaffOverridesSchema.safeParse({ "5": 21 }).success).toBe(false);
  });

  it("the full template form payload with a Friday-only override parses", () => {
    const r = templateSchema.safeParse({
      label: "Close",
      startTime: "17:00",
      endTime: "23:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      color: "",
      dayTimeOverrides: { "7": { start: "10:00", end: "20:00" } },
      requiredStaff: "2",
      dayStaffOverrides: { "5": "4" },
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.dayStaffOverrides).toEqual({ "5": 4 });
    expect(r.success && r.data.requiredStaff).toBe(2);
  });
});
