import { describe, it, expect } from "vitest";
import {
  SWEEP_KINDS,
  SWEEP_SCHEDULE,
  DEFAULT_DIGEST_HOUR_LOCAL,
  DEFAULT_REMINDER_HOUR_LOCAL,
  LOCAL_HOURS,
  emptySummary,
  isLocalHour,
  localHourOf,
  sendHourFor,
  sweepDue,
  sweepSingletonKey,
  type DispatchBusiness,
} from "@/lib/jobs/dispatch";

/**
 * PERF-02 / PERF-03 — the pure dispatch maths: local hours across timezones
 * (including the DST boundaries the audit called out), which configured hour
 * each sweep follows, the at-or-past due rule that survives a skipped hour,
 * and the per-tenant-per-day singleton key.
 */
const sydney: DispatchBusiness = {
  id: "syd",
  timezone: "Australia/Sydney",
  digestHourLocal: 7,
  reminderHourLocal: 17,
};
const perth: DispatchBusiness = {
  ...sydney,
  id: "per",
  timezone: "Australia/Perth",
};
const london: DispatchBusiness = {
  ...sydney,
  id: "lon",
  timezone: "Europe/London",
};
const la: DispatchBusiness = {
  ...sydney,
  id: "la",
  timezone: "America/Los_Angeles",
};

describe("local hour", () => {
  it("reads the wall-clock hour in each location's own zone", () => {
    const t = new Date("2026-09-04T21:30:00Z"); // 07:30 AEST, 05:30 AWST, 22:30 BST, 14:30 PDT
    expect(localHourOf(t, "Australia/Sydney")).toBe(7);
    expect(localHourOf(t, "Australia/Perth")).toBe(5);
    expect(localHourOf(t, "Europe/London")).toBe(22);
    expect(localHourOf(t, "America/Los_Angeles")).toBe(14);
    expect(localHourOf(new Date("2026-09-04T00:10:00Z"), "UTC")).toBe(0);
    expect(localHourOf(new Date("2026-09-04T23:59:00Z"), "UTC")).toBe(23);
  });

  it("handles the Sydney DST spring-forward (02:00 → 03:00) and fall-back (03:00 → 02:00)", () => {
    // 2026-10-04: clocks skip from 02:00 AEST to 03:00 AEDT.
    expect(
      localHourOf(new Date("2026-10-03T15:30:00Z"), "Australia/Sydney"),
    ).toBe(1);
    expect(
      localHourOf(new Date("2026-10-03T16:30:00Z"), "Australia/Sydney"),
    ).toBe(3);
    // 2026-04-05: 03:00 AEDT falls back to 02:00 AEST — 02:xx happens twice.
    expect(
      localHourOf(new Date("2026-04-04T15:30:00Z"), "Australia/Sydney"),
    ).toBe(2);
    expect(
      localHourOf(new Date("2026-04-04T16:30:00Z"), "Australia/Sydney"),
    ).toBe(2);
    expect(
      localHourOf(new Date("2026-04-04T17:30:00Z"), "Australia/Sydney"),
    ).toBe(3);
  });
});

describe("send hours", () => {
  it("routes each sweep to the configured or fixed hour", () => {
    const biz = { ...sydney, digestHourLocal: 9, reminderHourLocal: 18 };
    expect(sendHourFor("certReminder", biz)).toBe(9);
    expect(sendHourFor("orderReminder", biz)).toBe(9);
    expect(sendHourFor("formResponseDigest", biz)).toBe(9);
    expect(sendHourFor("staffShiftReminder", biz)).toBe(18);
    expect(sendHourFor("photoRetention", biz)).toBe(3);
    expect(sendHourFor("staffLoanExpiry", biz)).toBe(1);
    for (const k of SWEEP_KINDS) expect(SWEEP_SCHEDULE[k]).toBeTruthy();
    expect(DEFAULT_DIGEST_HOUR_LOCAL).toBe(7);
    expect(DEFAULT_REMINDER_HOUR_LOCAL).toBe(17);
    expect(LOCAL_HOURS).toHaveLength(24);
    expect(isLocalHour(0)).toBe(true);
    expect(isLocalHour(23)).toBe(true);
    expect(isLocalHour(24)).toBe(false);
    expect(isLocalHour(7.5)).toBe(false);
    expect(isLocalHour("7")).toBe(false);
  });
});

describe("due rule", () => {
  it("is due once the LOCAL hour reaches the target — different tenants at one instant", () => {
    const t = new Date("2026-09-04T21:30:00Z");
    expect(sweepDue("certReminder", sydney, t)).toMatchObject({
      due: true,
      runDate: "2026-09-05",
      localHour: 7,
      targetHour: 7,
    });
    expect(sweepDue("certReminder", perth, t).due).toBe(false); // 05:30
    expect(sweepDue("certReminder", london, t)).toMatchObject({
      due: true,
      runDate: "2026-09-04",
    });
    expect(sweepDue("certReminder", la, t).due).toBe(true); // 14:30
    expect(sweepDue("staffShiftReminder", sydney, t).due).toBe(false); // 07:30 < 17
    expect(sweepDue("staffShiftReminder", london, t).due).toBe(true); // 22:30
    expect(sweepDue("photoRetention", perth, t).due).toBe(true); // 05:30 ≥ 3
  });

  it("still fires on a day whose target hour was skipped by DST", () => {
    const biz = { ...sydney, digestHourLocal: 2 };
    // 02:00 never happens on 2026-10-04; the 03:30 tick is at-or-past.
    expect(
      sweepDue("certReminder", biz, new Date("2026-10-03T16:30:00Z")),
    ).toMatchObject({
      due: true,
      runDate: "2026-10-04",
      localHour: 3,
    });
    expect(
      sweepDue("certReminder", biz, new Date("2026-10-03T15:30:00Z")).due,
    ).toBe(false);
  });

  it("keys one job per tenant per sweep per local day, and starts an empty summary", () => {
    expect(sweepSingletonKey("certReminder", "b1", "2026-09-05")).toBe(
      "certReminder:b1:2026-09-05",
    );
    const s = emptySummary();
    expect(s.scanned).toBe(0);
    expect(Object.keys(s.enqueued).sort()).toEqual([...SWEEP_KINDS].sort());
    expect(Object.values(s.enqueued).every((n) => n === 0)).toBe(true);
  });
});
