import { describe, it, expect } from "vitest";
import { loanStatus, isLoanActiveOn } from "@/lib/staff-loan";

describe("staff loan status (pure)", () => {
  const start = "2026-06-10";
  const end = "2026-06-14";

  it("is upcoming before the start date", () => {
    expect(loanStatus(start, end, "2026-06-09")).toBe("upcoming");
    expect(isLoanActiveOn(start, end, "2026-06-09")).toBe(false);
  });

  it("is active on the inclusive start and end and in between", () => {
    expect(loanStatus(start, end, "2026-06-10")).toBe("active");
    expect(loanStatus(start, end, "2026-06-12")).toBe("active");
    expect(loanStatus(start, end, "2026-06-14")).toBe("active");
    expect(isLoanActiveOn(start, end, "2026-06-14")).toBe(true);
  });

  it("is ended the day after the end date", () => {
    expect(loanStatus(start, end, "2026-06-15")).toBe("ended");
    expect(isLoanActiveOn(start, end, "2026-06-15")).toBe(false);
  });

  it("handles a single-day loan", () => {
    expect(loanStatus("2026-06-10", "2026-06-10", "2026-06-10")).toBe("active");
    expect(loanStatus("2026-06-10", "2026-06-10", "2026-06-11")).toBe("ended");
  });
});
