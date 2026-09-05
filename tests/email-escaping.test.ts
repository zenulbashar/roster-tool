import { describe, it, expect } from "vitest";
import { env } from "@/lib/env";
import { esc, safeCtaUrl } from "@/lib/email/escape";
import {
  availabilityRequestEmail,
  reminderEmail,
  publishedRosterEmail,
  leaveDecisionEmail,
  shiftClaimApprovedEmail,
  shiftCoveredEmail,
  certificationReminderEmail,
  orderReminderEmail,
  formResponseDigestEmail,
} from "@/lib/email/templates";

/**
 * SEC-16 regression guard: nothing interpolated into an email's HTML body may
 * arrive as live markup. The staff-entered stock `quantity` is the path that
 * crosses a privilege boundary (staff → owner inbox, from Roster's own
 * DKIM-signed domain), so it is asserted explicitly; the rest are swept.
 */
const PAYLOAD = `<a href="https://evil.example/pay">Update bank details</a>`;
const ESCAPED = "&lt;a href=&quot;https://evil.example/pay&quot;&gt;";

function expectEscaped(html: string) {
  expect(html).not.toContain('<a href="https://evil.example');
  expect(html).toContain(ESCAPED);
}

describe("esc()", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(esc(`<b a="x" c='y'>&</b>`)).toBe(
      "&lt;b a=&quot;x&quot; c=&#39;y&#39;&gt;&amp;&lt;/b&gt;",
    );
  });
  it("renders null/undefined as empty", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("safeCtaUrl()", () => {
  it("keeps our own links", () => {
    expect(safeCtaUrl(`${env.APP_URL}/a/tok`)).toBe(`${env.APP_URL}/a/tok`);
  });
  it("replaces a foreign destination with the app root", () => {
    expect(safeCtaUrl("https://evil.example/x")).toBe(env.APP_URL);
    expect(safeCtaUrl(`${env.APP_URL}.evil.example/x`)).toBe(env.APP_URL);
  });
  it("attribute-escapes the result", () => {
    expect(safeCtaUrl(`${env.APP_URL}/a/"><script>`)).not.toContain('"><');
  });
});

describe("email templates escape every HTML interpolation", () => {
  it("staff-entered stock quantity cannot inject markup into the owner's order reminder", () => {
    const mail = orderReminderEmail({
      businessName: "Cafe",
      suppliers: [
        {
          supplierName: "Beans Co",
          deliveryText: "Mon 08/06",
          needsOrder: [{ name: "Milk", quantity: PAYLOAD }],
          low: [{ name: PAYLOAD, quantity: null }],
        },
      ],
    });
    expectEscaped(mail.html);
    // The plain-text part is not HTML and stays as typed.
    expect(mail.text).toContain(PAYLOAD);
  });

  it("owner-authored names/labels are escaped in every template", () => {
    const mails = [
      availabilityRequestEmail({
        businessName: PAYLOAD,
        staffName: PAYLOAD,
        periodLabel: PAYLOAD,
        link: `${env.APP_URL}/a/tok`,
        deadlineText: PAYLOAD,
      }),
      reminderEmail({
        businessName: PAYLOAD,
        staffName: PAYLOAD,
        periodLabel: PAYLOAD,
        link: `${env.APP_URL}/a/tok`,
        deadlineText: PAYLOAD,
      }),
      publishedRosterEmail({
        businessName: PAYLOAD,
        staffName: PAYLOAD,
        periodLabel: PAYLOAD,
        shifts: [{ dayText: PAYLOAD, label: PAYLOAD, timeText: PAYLOAD }],
        publicUrl: `${env.APP_URL}/r/slug`,
      }),
      leaveDecisionEmail({
        businessName: PAYLOAD,
        staffName: PAYLOAD,
        leaveTypeLabel: PAYLOAD,
        dateRangeText: PAYLOAD,
        approved: true,
      }),
      shiftClaimApprovedEmail({
        businessName: PAYLOAD,
        staffName: PAYLOAD,
        dayText: PAYLOAD,
        label: PAYLOAD,
        timeText: PAYLOAD,
      }),
      shiftCoveredEmail({
        businessName: PAYLOAD,
        staffName: PAYLOAD,
        coveredByName: PAYLOAD,
        dayText: PAYLOAD,
        label: PAYLOAD,
        timeText: PAYLOAD,
      }),
      certificationReminderEmail({
        businessName: PAYLOAD,
        items: [
          {
            staffName: PAYLOAD,
            certName: PAYLOAD,
            phrase: PAYLOAD,
            expiryText: PAYLOAD,
          },
        ],
      }),
      formResponseDigestEmail({
        businessName: PAYLOAD,
        items: [
          { title: PAYLOAD, count: 2, url: `${env.APP_URL}/app/forms/x` },
        ],
      }),
    ];
    for (const mail of mails) expectEscaped(mail.html);
  });

  it("a CTA pointing off-site is neutralised", () => {
    const mail = availabilityRequestEmail({
      businessName: "Cafe",
      staffName: "Ava",
      periodLabel: "Week",
      link: "https://evil.example/phish",
    });
    expect(mail.html).not.toContain("evil.example");
    // The plain-text part carries the link verbatim by design (it is built by
    // the caller from APP_URL); the HTML side is what mail clients render.
  });
});
