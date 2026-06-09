import { describe, it, expect } from "vitest";
import {
  daysUntil,
  certStatus,
  dueReminderStage,
  expiryPhrase,
} from "@/lib/certification";

const TODAY = "2026-06-09";
const LEAD = 30;

describe("daysUntil", () => {
  it("counts calendar days, negative once past", () => {
    expect(daysUntil("2026-06-09", TODAY)).toBe(0);
    expect(daysUntil("2026-06-16", TODAY)).toBe(7);
    expect(daysUntil("2026-07-09", TODAY)).toBe(30);
    expect(daysUntil("2026-06-06", TODAY)).toBe(-3);
  });
});

describe("certStatus", () => {
  it("is valid beyond the lead window", () => {
    expect(certStatus("2026-07-10", TODAY, LEAD)).toBe("valid"); // 31 days
  });
  it("is expiring exactly at the lead boundary and within it", () => {
    expect(certStatus("2026-07-09", TODAY, LEAD)).toBe("expiring"); // 30 days
    expect(certStatus("2026-06-16", TODAY, LEAD)).toBe("expiring"); // 7 days
  });
  it("is expired on the day of expiry and after", () => {
    expect(certStatus("2026-06-09", TODAY, LEAD)).toBe("expired"); // 0 days
    expect(certStatus("2026-06-01", TODAY, LEAD)).toBe("expired"); // past
  });
});

describe("dueReminderStage", () => {
  it("fires early at the lead boundary when nothing sent", () => {
    expect(dueReminderStage("2026-07-09", TODAY, LEAD, null)).toBe("early");
  });
  it("fires final at 7 days and not again once sent", () => {
    expect(dueReminderStage("2026-06-16", TODAY, LEAD, null)).toBe("final");
    expect(dueReminderStage("2026-06-16", TODAY, LEAD, "final")).toBeNull();
    // early already sent, now within final → still due (more urgent).
    expect(dueReminderStage("2026-06-16", TODAY, LEAD, "early")).toBe("final");
  });
  it("fires expired on the day of expiry and after, once", () => {
    expect(dueReminderStage("2026-06-09", TODAY, LEAD, null)).toBe("expired");
    expect(dueReminderStage("2026-06-01", TODAY, LEAD, "final")).toBe("expired");
    expect(dueReminderStage("2026-06-01", TODAY, LEAD, "expired")).toBeNull();
  });
  it("does not re-fire early on a later day before the final window", () => {
    // 20 days out, early already sent → nothing new.
    expect(dueReminderStage("2026-06-29", TODAY, LEAD, "early")).toBeNull();
  });
  it("collapses skipped stages: a cert added inside the final window", () => {
    // 5 days out, never reminded → straight to final.
    expect(dueReminderStage("2026-06-14", TODAY, LEAD, null)).toBe("final");
  });
  it("is null outside every window (beyond lead, nothing sent)", () => {
    expect(dueReminderStage("2026-08-01", TODAY, LEAD, null)).toBeNull();
  });
});

describe("expiryPhrase", () => {
  it("formats future, today and past", () => {
    expect(expiryPhrase(7)).toBe("expires in 7 days");
    expect(expiryPhrase(1)).toBe("expires in 1 day");
    expect(expiryPhrase(0)).toBe("expires today");
    expect(expiryPhrase(-1)).toBe("expired 1 day ago");
    expect(expiryPhrase(-3)).toBe("expired 3 days ago");
  });
});
