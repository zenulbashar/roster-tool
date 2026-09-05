import { describe, it, expect } from "vitest";
import { env } from "@/lib/env";
import { availabilityRequestEmail, reminderEmail } from "@/lib/email/templates";

/**
 * SEC-17 regression guard: the availability link is re-openable for 21 days
 * (findRequestByToken gates only on expiry — staff legitimately revise their
 * answers), so the email must never tell staff it "works once". The /a page's
 * own banner already says "You can change it any time using this link".
 */
describe("availability email copy tells the truth about the link", () => {
  const input = {
    businessName: "Cafe",
    staffName: "Ava",
    periodLabel: "Week 1",
    link: `${env.APP_URL}/a/tok`,
  };
  for (const [name, mail] of [
    ["request", availabilityRequestEmail(input)],
    ["reminder", reminderEmail(input)],
  ] as const) {
    it(`${name}: never claims single use, and warns that the link is powerful`, () => {
      for (const part of [mail.html, mail.text]) {
        expect(part).not.toMatch(/works once/i);
        expect(part).toMatch(/anyone who has it can change your answers/i);
      }
    });
  }
});
