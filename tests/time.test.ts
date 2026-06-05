import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateOnly,
  formatTimeOnly,
  eachDate,
  isoWeekday,
} from "@/lib/time";

describe("formatDate", () => {
  it("renders DD/MM/YYYY in Sydney time", () => {
    // 2025-06-09T00:00:00Z is already 9 June in Sydney (UTC+10).
    expect(formatDate(new Date("2025-06-09T00:00:00Z"))).toBe("09/06/2025");
  });

  it("shifts the calendar date into the business timezone", () => {
    // 23:30 UTC on 8 June is 09:30 on 9 June in Sydney.
    expect(formatDate(new Date("2025-06-08T23:30:00Z"))).toBe("09/06/2025");
  });
});

describe("formatDateOnly", () => {
  it("renders weekday and DD/MM", () => {
    expect(formatDateOnly("2025-06-09")).toBe("Mon 09/06");
  });
});

describe("formatTimeOnly", () => {
  it("formats whole hours without minutes", () => {
    expect(formatTimeOnly("09:00")).toBe("9 am");
    expect(formatTimeOnly("17:00")).toBe("5 pm");
  });
  it("formats noon and midnight", () => {
    expect(formatTimeOnly("12:00")).toBe("12 pm");
    expect(formatTimeOnly("00:00")).toBe("12 am");
  });
  it("includes minutes when present", () => {
    expect(formatTimeOnly("17:30")).toBe("5:30 pm");
  });
});

describe("eachDate", () => {
  it("returns an inclusive range", () => {
    expect(eachDate("2025-06-09", "2025-06-11")).toEqual([
      "2025-06-09",
      "2025-06-10",
      "2025-06-11",
    ]);
  });
  it("returns a single day when start equals end", () => {
    expect(eachDate("2025-06-09", "2025-06-09")).toEqual(["2025-06-09"]);
  });
});

describe("isoWeekday", () => {
  it("maps Monday to 1 and Sunday to 7", () => {
    expect(isoWeekday("2025-06-09")).toBe(1); // Monday
    expect(isoWeekday("2025-06-15")).toBe(7); // Sunday
  });
});
