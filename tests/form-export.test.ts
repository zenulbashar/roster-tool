import { describe, it, expect } from "vitest";
import {
  buildResponsesCsv,
  exportFilename,
  type ExportResponse,
} from "@/lib/form-export";
import type { LiveField, StoredAnswer } from "@/lib/form-report";

const liveFields: LiveField[] = [
  { id: "f-name", label: "Your name", type: "short_text", position: 0 },
  { id: "f-size", label: "Size", type: "single_select", position: 1 },
  { id: "f-stars", label: "Stars", type: "rating", position: 2 },
];

function ans(
  over: Partial<StoredAnswer> & { fieldType: StoredAnswer["fieldType"] },
): StoredAnswer {
  return {
    fieldId: over.fieldId ?? null,
    fieldLabel: over.fieldLabel ?? "",
    fieldType: over.fieldType,
    valueText: over.valueText ?? null,
    valueNumber: over.valueNumber ?? null,
  };
}

function resp(over: Partial<ExportResponse>): ExportResponse {
  return {
    id: over.id ?? "r1",
    submittedAt: over.submittedAt ?? new Date("2026-06-16T01:02:03.000Z"),
    channel: over.channel ?? "public",
    source: over.source ?? null,
    respondentName: over.respondentName ?? null,
    answers: over.answers ?? [],
  };
}

/** Minimal CSV line splitter that respects quoted fields (for assertions). */
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

describe("buildResponsesCsv", () => {
  it("emits metadata + live-field columns with values via displayAnswer", () => {
    const csv = buildResponsesCsv(
      liveFields,
      [
        resp({
          id: "abc",
          source: "qr",
          answers: [
            ans({
              fieldId: "f-name",
              fieldLabel: "Your name",
              fieldType: "short_text",
              valueText: "Ada",
            }),
            ans({
              fieldId: "f-size",
              fieldLabel: "Size",
              fieldType: "single_select",
              valueText: "Large",
            }),
            ans({
              fieldId: "f-stars",
              fieldLabel: "Stars",
              fieldType: "rating",
              valueNumber: 5,
            }),
          ],
        }),
      ],
      false,
    );
    const lines = csv.split("\n");
    expect(parseLine(lines[0]!)).toEqual([
      "Submitted at",
      "Channel",
      "Respondent",
      "Source",
      "Response id",
      "Your name",
      "Size",
      "Stars",
    ]);
    expect(parseLine(lines[1]!)).toEqual([
      "2026-06-16T01:02:03.000Z",
      "public",
      "Public", // respondent label for a public row
      "qr",
      "abc",
      "Ada",
      "Large", // single_select shows the stored label
      "5", // rating from value_number
    ]);
  });

  it("leaves a blank cell when a response has no answer for a field", () => {
    const csv = buildResponsesCsv(
      liveFields,
      [
        resp({
          answers: [
            ans({
              fieldId: "f-name",
              fieldLabel: "Your name",
              fieldType: "short_text",
              valueText: "Bea",
            }),
          ],
        }),
      ],
      false,
    );
    const row = parseLine(csv.split("\n")[1]!);
    expect(row.slice(5)).toEqual(["Bea", "", ""]); // Size + Stars blank
  });

  it("appends an orphan column for a since-deleted field (field_id null)", () => {
    const csv = buildResponsesCsv(
      liveFields,
      [
        resp({
          answers: [
            ans({
              fieldId: "f-name",
              fieldLabel: "Your name",
              fieldType: "short_text",
              valueText: "Cleo",
            }),
            ans({
              fieldId: null,
              fieldLabel: "Old Q",
              fieldType: "yes_no",
              valueText: "Yes",
            }),
          ],
        }),
      ],
      false,
    );
    const lines = csv.split("\n");
    expect(parseLine(lines[0]!)).toContain("Old Q (removed)");
    // orphan column is last; its value is present.
    expect(parseLine(lines[1]!).at(-1)).toBe("Yes");
  });

  it("orders orphan columns deterministically (by label, then type)", () => {
    const csv = buildResponsesCsv(
      [],
      [
        resp({
          answers: [
            ans({
              fieldId: null,
              fieldLabel: "Zeta",
              fieldType: "short_text",
              valueText: "z",
            }),
            ans({
              fieldId: null,
              fieldLabel: "Alpha",
              fieldType: "short_text",
              valueText: "a",
            }),
          ],
        }),
      ],
      false,
    );
    const header = parseLine(csv.split("\n")[0]!);
    expect(header.slice(5)).toEqual(["Alpha (removed)", "Zeta (removed)"]);
  });

  it("escapes commas, quotes and newlines (RFC-4180)", () => {
    const csv = buildResponsesCsv(
      [{ id: "f-c", label: "Comment", type: "long_text", position: 0 }],
      [
        resp({
          answers: [
            ans({
              fieldId: "f-c",
              fieldLabel: "Comment",
              fieldType: "long_text",
              valueText: 'a, b "c"\nd',
            }),
          ],
        }),
      ],
      false,
    );
    const lines = csv.split("\n");
    // The embedded newline keeps the record quoted across the physical newline.
    expect(csv).toContain('"a, b ""c""\nd"');
    expect(lines[0]).toBe(
      "Submitted at,Channel,Respondent,Source,Response id,Comment",
    );
  });

  it("neutralises formula injection in field values AND the source", () => {
    const csv = buildResponsesCsv(
      [{ id: "f-c", label: "Comment", type: "short_text", position: 0 }],
      [
        resp({
          source: "=cmd()",
          answers: [
            ans({
              fieldId: "f-c",
              fieldLabel: "Comment",
              fieldType: "short_text",
              valueText: "=1+2",
            }),
          ],
        }),
      ],
      false,
    );
    const row = parseLine(csv.split("\n")[1]!);
    expect(row[3]).toBe("'=cmd()"); // source neutralised (now after Respondent)
    expect(row[5]).toBe("'=1+2"); // field value neutralised
  });
});

describe("buildResponsesCsv — respondent column", () => {
  const one = (over: Partial<ExportResponse>, allowAnonymous: boolean) => {
    const csv = buildResponsesCsv([], [resp(over)], allowAnonymous);
    return parseLine(csv.split("\n")[1]!)[2]; // Respondent is the 3rd column
  };

  it("public row → 'Public' regardless of allowAnonymous", () => {
    expect(one({ channel: "public" }, false)).toBe("Public");
    expect(one({ channel: "public" }, true)).toBe("Public");
  });

  it("internal anonymous form → 'Anonymous'", () => {
    expect(one({ channel: "internal", respondentName: null }, true)).toBe(
      "Anonymous",
    );
  });

  it("internal attributed → the staff name", () => {
    expect(one({ channel: "internal", respondentName: "Ada" }, false)).toBe(
      "Ada",
    );
  });

  it("internal attributed with a dropped link → 'Former staff' (NOT 'Anonymous')", () => {
    // respondent_staff_id was SET NULL (staff deleted) but the form is
    // attributed — must not be mislabelled anonymous.
    expect(one({ channel: "internal", respondentName: null }, false)).toBe(
      "Former staff",
    );
  });
});

describe("exportFilename", () => {
  it("slugifies the title safely", () => {
    expect(exportFilename("Café Feedback!")).toBe("caf-feedback-responses.csv");
    expect(exportFilename('  "Weird/Name"\n ')).toBe(
      "weird-name-responses.csv",
    );
  });
  it("falls back to 'form' when nothing usable remains", () => {
    expect(exportFilename("***")).toBe("form-responses.csv");
    expect(exportFilename("")).toBe("form-responses.csv");
  });
});
