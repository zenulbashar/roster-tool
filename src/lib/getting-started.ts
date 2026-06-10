/**
 * Owner "Getting started" checklist — pure logic.
 *
 * Step state is DERIVED from existing data (does the business have staff, a
 * shift type, a roster period, a clock-in link…) — never a manual checkbox.
 * The checklist hides once all CORE steps are done; optional steps (inventory)
 * are bonus nudges and never keep it visible. No stored dismiss flag.
 */

/** Existence flags for one business, read tenant-scoped by `getSetupFlags`. */
export type SetupFlags = {
  hasStaff: boolean;
  hasShiftTemplate: boolean;
  hasRosterPeriod: boolean;
  /** A kiosk OR personal-phone clock-in link has been generated. */
  hasClockInLink: boolean;
  hasSupplier: boolean;
  hasItem: boolean;
};

export type GettingStartedStep = {
  key: keyof SetupFlags;
  title: string;
  description: string;
  href: string;
  done: boolean;
};

export type GettingStarted = {
  coreSteps: GettingStartedStep[];
  optionalSteps: GettingStartedStep[];
  coreDoneCount: number;
  coreTotal: number;
  /** Show while any CORE step is incomplete; optional steps never gate this. */
  showChecklist: boolean;
};

const CORE_STEPS: ReadonlyArray<Omit<GettingStartedStep, "done">> = [
  {
    key: "hasStaff",
    title: "Add your first staff member",
    description: "The people who work for you, with their email addresses.",
    href: "/app/staff",
  },
  {
    key: "hasShiftTemplate",
    title: "Create a shift type",
    description: "The shifts you run, like Morning or Evening.",
    href: "/app/templates",
  },
  {
    key: "hasRosterPeriod",
    title: "Build your first roster",
    description: "Pick a week and put people on shifts.",
    href: "/app/periods",
  },
  {
    key: "hasClockInLink",
    title: "Set up clock-in",
    description: "Get a clock-in link so staff can record their hours.",
    href: "/app/settings",
  },
];

const OPTIONAL_STEPS: ReadonlyArray<Omit<GettingStartedStep, "done">> = [
  {
    key: "hasSupplier",
    title: "Add a supplier",
    description: "Who you order stock from, and their delivery days.",
    href: "/app/suppliers",
  },
  {
    key: "hasItem",
    title: "Add your items",
    description: "The stock you keep, so staff can flag what's running low.",
    href: "/app/items",
  },
];

export function buildGettingStarted(flags: SetupFlags): GettingStarted {
  const coreSteps = CORE_STEPS.map((s) => ({ ...s, done: flags[s.key] }));
  const optionalSteps = OPTIONAL_STEPS.map((s) => ({
    ...s,
    done: flags[s.key],
  }));
  const coreDoneCount = coreSteps.filter((s) => s.done).length;
  return {
    coreSteps,
    optionalSteps,
    coreDoneCount,
    coreTotal: coreSteps.length,
    showChecklist: coreDoneCount < coreSteps.length,
  };
}
