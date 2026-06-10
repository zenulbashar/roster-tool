import { describe, it, expect } from "vitest";
import { buildGettingStarted, type SetupFlags } from "@/lib/getting-started";

const none: SetupFlags = {
  hasStaff: false,
  hasShiftTemplate: false,
  hasRosterPeriod: false,
  hasClockInLink: false,
  hasSupplier: false,
  hasItem: false,
};

const allCore: SetupFlags = {
  ...none,
  hasStaff: true,
  hasShiftTemplate: true,
  hasRosterPeriod: true,
  hasClockInLink: true,
};

describe("buildGettingStarted", () => {
  it("shows the checklist for a brand-new business with nothing done", () => {
    const r = buildGettingStarted(none);
    expect(r.showChecklist).toBe(true);
    expect(r.coreDoneCount).toBe(0);
    expect(r.coreTotal).toBe(4);
    expect(r.coreSteps.every((s) => !s.done)).toBe(true);
    expect(r.optionalSteps.every((s) => !s.done)).toBe(true);
  });

  it("counts partial core progress and keeps showing", () => {
    const r = buildGettingStarted({
      ...none,
      hasStaff: true,
      hasShiftTemplate: true,
    });
    expect(r.showChecklist).toBe(true);
    expect(r.coreDoneCount).toBe(2);
    expect(r.coreSteps.find((s) => s.key === "hasStaff")?.done).toBe(true);
    expect(r.coreSteps.find((s) => s.key === "hasRosterPeriod")?.done).toBe(
      false,
    );
  });

  it("still shows when only one core step remains", () => {
    const r = buildGettingStarted({ ...allCore, hasClockInLink: false });
    expect(r.showChecklist).toBe(true);
    expect(r.coreDoneCount).toBe(3);
  });

  it("hides once all core steps are done, even with optional steps incomplete", () => {
    const r = buildGettingStarted(allCore);
    expect(r.showChecklist).toBe(false);
    expect(r.coreDoneCount).toBe(4);
    expect(r.optionalSteps.every((s) => !s.done)).toBe(true);
  });

  it("hides when everything is done", () => {
    const r = buildGettingStarted({
      ...allCore,
      hasSupplier: true,
      hasItem: true,
    });
    expect(r.showChecklist).toBe(false);
  });

  it("optional progress never affects visibility or the core count", () => {
    const r = buildGettingStarted({
      ...none,
      hasSupplier: true,
      hasItem: true,
    });
    expect(r.showChecklist).toBe(true);
    expect(r.coreDoneCount).toBe(0);
    expect(r.optionalSteps.every((s) => s.done)).toBe(true);
  });

  it("links each incomplete step to the page where the owner does it", () => {
    const r = buildGettingStarted(none);
    const hrefs = Object.fromEntries(
      [...r.coreSteps, ...r.optionalSteps].map((s) => [s.key, s.href]),
    );
    expect(hrefs).toEqual({
      hasStaff: "/app/staff",
      hasShiftTemplate: "/app/templates",
      hasRosterPeriod: "/app/periods",
      hasClockInLink: "/app/settings",
      hasSupplier: "/app/suppliers",
      hasItem: "/app/items",
    });
  });
});
