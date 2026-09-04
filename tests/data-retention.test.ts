import { describe, it, expect } from "vitest";
import {
  RETENTION_DAYS,
  RETENTION_POLICIES,
  retentionCutoff,
  totalDeleted,
  type RetentionResult,
} from "@/lib/data-retention";

/**
 * PERF-10 — the retention policy table is code, so its invariants are pinned:
 * every period is a positive whole number of days, unread notices outlive
 * read ones, the admin accountability record is kept at least two years, and
 * the cutoff maths is exact.
 */
describe("data retention policies (pure)", () => {
  it("every policy is a positive whole number of days", () => {
    for (const [name, days] of Object.entries(RETENTION_DAYS)) {
      expect(Number.isInteger(days), name).toBe(true);
      expect(days, name).toBeGreaterThan(0);
    }
  });

  it("unread notices live longer than read ones, and the audit log keeps 24 months", () => {
    expect(RETENTION_DAYS.notificationUnread).toBeGreaterThan(
      RETENTION_DAYS.notificationRead,
    );
    expect(RETENTION_DAYS.staffNotificationUnread).toBeGreaterThan(
      RETENTION_DAYS.staffNotificationRead,
    );
    expect(RETENTION_DAYS.adminActivity).toBeGreaterThanOrEqual(730);
  });

  it("lists every keyed policy plus the expiry-driven rate-limit sweep exactly once", () => {
    const keyed = Object.keys(RETENTION_DAYS);
    expect(new Set(RETENTION_POLICIES).size).toBe(RETENTION_POLICIES.length);
    for (const k of keyed) expect(RETENTION_POLICIES).toContain(k);
    expect(RETENTION_POLICIES).toContain("formRateLimit");
    expect(RETENTION_POLICIES).toHaveLength(keyed.length + 1);
  });

  it("computes cutoffs in exact days from the given instant", () => {
    const now = new Date("2026-09-04T04:00:00.000Z");
    expect(retentionCutoff(now, 1).toISOString()).toBe(
      "2026-09-03T04:00:00.000Z",
    );
    expect(retentionCutoff(now, 180).toISOString()).toBe(
      "2026-03-08T04:00:00.000Z",
    );
    expect(retentionCutoff(now, 730).toISOString()).toBe(
      "2024-09-04T04:00:00.000Z",
    );
  });

  it("totals a result", () => {
    const r = Object.fromEntries(
      RETENTION_POLICIES.map((p, i) => [p, i]),
    ) as RetentionResult;
    expect(totalDeleted(r)).toBe(
      (RETENTION_POLICIES.length * (RETENTION_POLICIES.length - 1)) / 2,
    );
  });
});
