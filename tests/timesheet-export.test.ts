import { describe, it, expect } from "vitest";
import {
  buildApprovedHoursCsv,
  hoursWorked,
  csvCell,
  sanitizeCsvValue,
  csvField,
  APPROVED_HOURS_DISCLAIMER,
  type ExportRow,
} from "@/lib/timesheet-export";

const TZ = "Australia/Sydney";

function row(over: Partial<ExportRow> = {}): ExportRow {
  return {
    staffName: "Ava Nguyen",
    staffEmail: "ava@example.com",
    role: null,
    clockInAt: new Date("2026-06-08T23:00:00Z"), // 09:00 Sydney 09/06 (UTC+10)
    clockOutAt: new Date("2026-06-09T07:00:00Z"), // 17:00 Sydney 09/06
    breakMinutes: 0,
    withinGeofence: null,
    payRateCents: 2850,
    rateType: "flat",
    rateLabel: null,
    ...over,
  };
}

describe("hoursWorked", () => {
  it("computes decimal hours for a closed entry", () => {
    expect(
      hoursWorked(
        new Date("2026-06-09T23:00:00Z"),
        new Date("2026-06-10T07:30:00Z"),
      ),
    ).toBe(8.5);
  });
  it("is null for an open entry", () => {
    expect(hoursWorked(new Date(), null)).toBeNull();
  });
  it("clamps a non-positive span to 0", () => {
    const t = new Date("2026-06-09T23:00:00Z");
    expect(hoursWorked(t, t)).toBe(0);
  });
  it("subtracts an unpaid break, clamped at zero", () => {
    const inAt = new Date("2026-06-09T23:00:00Z");
    const outAt = new Date("2026-06-10T07:30:00Z"); // 8.5h gross
    expect(hoursWorked(inAt, outAt, 30)).toBe(8);
    expect(hoursWorked(inAt, outAt, 60)).toBe(7.5);
    // Break at/over the span → 0, never negative.
    const shortOut = new Date("2026-06-09T23:20:00Z"); // 20 min
    expect(hoursWorked(inAt, shortOut, 30)).toBe(0);
  });
});

describe("csvCell", () => {
  it("leaves plain values untouched", () => {
    expect(csvCell("Ava")).toBe("Ava");
  });
  it("quotes and escapes commas, quotes and newlines", () => {
    expect(csvCell("Smith, Ava")).toBe('"Smith, Ava"');
    expect(csvCell('She said "hi"')).toBe('"She said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("sanitizeCsvValue / csvField (formula-injection hardening)", () => {
  it("prefixes a leading dangerous character with an apostrophe", () => {
    for (const bad of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) {
      expect(sanitizeCsvValue(bad)).toBe(`'${bad}`);
    }
  });
  it("leaves safe values untouched", () => {
    expect(sanitizeCsvValue("Ava")).toBe("Ava");
    expect(sanitizeCsvValue("3.5")).toBe("3.5");
    expect(sanitizeCsvValue("")).toBe("");
  });
  it("neutralises THEN RFC-4180 escapes (guard inside the quotes)", () => {
    // A formula that also contains a comma → both guarded and quoted.
    expect(csvField("=SUM(A1,A2)")).toBe(`"'=SUM(A1,A2)"`);
    expect(csvField("=1+1")).toBe("'=1+1");
  });
});

describe("buildApprovedHoursCsv", () => {
  it("includes the title, disclaimer and header", () => {
    const csv = buildApprovedHoursCsv([], {
      timezone: TZ,
      businessName: "Corner Cafe",
    });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Corner Cafe — Approved hours");
    expect(lines[1]).toBe(csvCellOf(APPROVED_HOURS_DISCLAIMER));
    expect(lines[2]).toBe("");
    expect(lines[3]).toContain("Staff name,Staff email,Role,Date,Clock in");
    expect(lines[3]).toContain("Clock out,Break (min),Total hours");
    expect(lines[3]).toContain("Estimated amount,Location verified");
  });

  it("formats a row: tz times, DD/MM date, hours, rate and estimate", () => {
    const csv = buildApprovedHoursCsv([row()], {
      timezone: TZ,
      businessName: "Corner Cafe",
    });
    const dataLine = csv.split("\r\n")[4]!;
    expect(dataLine).toBe(
      "Ava Nguyen,ava@example.com,,09/06/2026,09:00,17:00,0,8.00,flat,28.50,228.00,",
    );
  });

  it("includes the role column when set", () => {
    const csv = buildApprovedHoursCsv([row({ role: "Barista" })], {
      timezone: TZ,
      businessName: "Corner Cafe",
    });
    expect(csv.split("\r\n")[4]!).toBe(
      "Ava Nguyen,ava@example.com,Barista,09/06/2026,09:00,17:00,0,8.00,flat,28.50,228.00,",
    );
  });

  it("records the break and nets the total-hours + estimate", () => {
    const csv = buildApprovedHoursCsv([row({ breakMinutes: 30 })], {
      timezone: TZ,
      businessName: "Corner Cafe",
    });
    // 8h gross − 30m break = 7.5h net; 7.5 × 28.50 = 213.75.
    expect(csv.split("\r\n")[4]!).toBe(
      "Ava Nguyen,ava@example.com,,09/06/2026,09:00,17:00,30,7.50,flat,28.50,213.75,",
    );
  });

  it("folds a rate label into the rate type cell", () => {
    const csv = buildApprovedHoursCsv(
      [row({ rateType: "award", rateLabel: "Level 2 cook" })],
      { timezone: TZ, businessName: "Cafe" },
    );
    expect(csv.split("\r\n")[4]).toContain("award (Level 2 cook)");
  });

  it("leaves hours, rate and estimate blank when missing", () => {
    const open = row({ clockOutAt: null, payRateCents: null });
    const dataLine = buildApprovedHoursCsv([open], {
      timezone: TZ,
      businessName: "Cafe",
    }).split("\r\n")[4]!;
    // 09:00 then empty clock out, break 0, empty hours, flat, empty rate/estimate.
    expect(dataLine).toBe(
      "Ava Nguyen,ava@example.com,,09/06/2026,09:00,,0,,flat,,,",
    );
  });

  it("marks location-verified entries with Yes", () => {
    const csv = buildApprovedHoursCsv([row({ withinGeofence: true })], {
      timezone: TZ,
      businessName: "Cafe",
    });
    expect(csv.split("\r\n")[4]!.endsWith(",Yes")).toBe(true);
  });
});

/** Helper mirroring csvCell for the disclaimer assertion. */
function csvCellOf(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
