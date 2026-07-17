import { describe, expect, it } from "vitest";
import {
  digestWindowStart,
  digestSummary,
  orderDigestItems,
} from "@/lib/form-digest";
import { formResponseDigestEmail } from "@/lib/email";

describe("digestWindowStart", () => {
  const now = new Date("2026-07-17T21:00:00Z");

  it("uses the cursor when one exists", () => {
    const lastAt = new Date("2026-07-15T21:00:00Z");
    expect(digestWindowStart(lastAt, now)).toEqual(lastAt);
  });

  it("falls back to the last 24h for a never-sent business", () => {
    expect(digestWindowStart(null, now)).toEqual(
      new Date("2026-07-16T21:00:00Z"),
    );
  });
});

describe("digestSummary + ordering", () => {
  it("totals across forms with singular/plural wording", () => {
    expect(
      digestSummary([
        { formId: "a", title: "A", count: 3 },
        { formId: "b", title: "B", count: 11 },
      ]),
    ).toBe("14 new form responses");
    expect(digestSummary([{ formId: "a", title: "A", count: 1 }])).toBe(
      "1 new form response",
    );
  });

  it("orders busiest form first, ties by title", () => {
    expect(
      orderDigestItems([
        { formId: "a", title: "Zeta", count: 2 },
        { formId: "b", title: "Alpha", count: 5 },
        { formId: "c", title: "Beta", count: 2 },
      ]).map((i) => i.title),
    ).toEqual(["Alpha", "Beta", "Zeta"]);
  });
});

describe("formResponseDigestEmail", () => {
  it("carries counts, titles and links — and nothing else", () => {
    const email = formResponseDigestEmail({
      businessName: "Cafe X",
      items: [
        {
          title: "Customer feedback",
          count: 12,
          url: "https://app.test/app/forms/f1/responses",
        },
        {
          title: "Staff survey",
          count: 1,
          url: "https://app.test/app/forms/f2/responses",
        },
      ],
    });
    expect(email.subject).toBe("13 new form responses — Cafe X");
    expect(email.text).toContain("Customer feedback — 12 new responses");
    expect(email.text).toContain("Staff survey — 1 new response");
    expect(email.text).toContain("https://app.test/app/forms/f1/responses");
    expect(email.html).toContain("Customer feedback");
    // The opt-out pointer is part of the footer copy.
    expect(email.html).toContain("Settings");
  });
});
