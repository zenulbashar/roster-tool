import type { OutgoingEmail } from "./transport";

/**
 * Plain, high-contrast HTML emails with a matching plain-text part. Inline
 * styles only (email clients ignore stylesheets). Kept simple and friendly.
 */

function layout(opts: {
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const button =
    opts.ctaUrl && opts.ctaLabel
      ? `<p style="margin:24px 0;">
           <a href="${opts.ctaUrl}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:700;display:inline-block;">${opts.ctaLabel}</a>
         </p>
         <p style="font-size:13px;color:#4b5563;">If the button doesn't work, copy this link into your browser:<br><a href="${opts.ctaUrl}" style="color:#1d4ed8;">${opts.ctaUrl}</a></p>`
      : "";
  return `<!doctype html>
<html><body style="margin:0;background:#f9fafb;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d1d5db;border-radius:12px;padding:28px;">
    <h1 style="font-size:22px;margin:0 0 12px;">${opts.heading}</h1>
    ${opts.bodyHtml}
    ${button}
    ${opts.footer ? `<p style="font-size:13px;color:#4b5563;margin-top:24px;">${opts.footer}</p>` : ""}
  </div>
</body></html>`;
}

export function availabilityRequestEmail(input: {
  businessName: string;
  staffName: string;
  periodLabel: string;
  link: string;
  deadlineText?: string;
}): OutgoingEmail {
  const { businessName, staffName, periodLabel, link, deadlineText } = input;
  const deadlineLine = deadlineText
    ? `Please let us know by <strong>${deadlineText}</strong>.`
    : "";
  const deadlineText2 = deadlineText
    ? `Please let us know by ${deadlineText}.`
    : "";
  return {
    to: "", // filled by the caller
    subject: `${businessName}: when can you work for "${periodLabel}"?`,
    html: layout({
      heading: `Hi ${staffName},`,
      bodyHtml: `<p>${businessName} is putting together the roster for <strong>${periodLabel}</strong>. Tap the button to tell us which shifts you can work. ${deadlineLine}</p>`,
      ctaLabel: "Choose my shifts",
      ctaUrl: link,
      footer:
        "This link is just for you. Please don't forward it. It works once and expires.",
    }),
    text: [
      `Hi ${staffName},`,
      "",
      `${businessName} is putting together the roster for "${periodLabel}".`,
      `Open this link to tell us which shifts you can work:`,
      link,
      deadlineText2,
      "",
      "This link is just for you. Please don't forward it.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function publishedRosterEmail(input: {
  businessName: string;
  staffName: string;
  periodLabel: string;
  shifts: Array<{ dayText: string; label: string; timeText: string }>;
  publicUrl: string;
}): OutgoingEmail {
  const { businessName, staffName, periodLabel, shifts, publicUrl } = input;
  const hasShifts = shifts.length > 0;

  const listHtml = hasShifts
    ? `<ul style="padding-left:18px;margin:12px 0;">${shifts
        .map(
          (s) =>
            `<li style="margin:4px 0;"><strong>${s.dayText}</strong> — ${s.label}, ${s.timeText}</li>`,
        )
        .join("")}</ul>`
    : `<p>You&rsquo;re not rostered on this time. Enjoy your time off!</p>`;

  const listText = hasShifts
    ? shifts
        .map((s) => `  • ${s.dayText} — ${s.label}, ${s.timeText}`)
        .join("\n")
    : "You're not rostered on this time. Enjoy your time off!";

  return {
    to: "",
    subject: `Your shifts for "${periodLabel}" — ${businessName}`,
    html: layout({
      heading: `Hi ${staffName}, here are your shifts`,
      bodyHtml: `<p>${businessName} has published the roster for <strong>${periodLabel}</strong>. Here&rsquo;s when you&rsquo;re working:</p>${listHtml}`,
      ctaLabel: "See the full roster",
      ctaUrl: publicUrl,
      footer: "Questions about your shifts? Reply to your manager directly.",
    }),
    text: [
      `Hi ${staffName},`,
      "",
      `${businessName} has published the roster for "${periodLabel}". Your shifts:`,
      "",
      listText,
      "",
      `See the full roster: ${publicUrl}`,
    ].join("\n"),
  };
}

export function leaveDecisionEmail(input: {
  businessName: string;
  staffName: string;
  /** Friendly leave-type label, e.g. "Annual leave". */
  leaveTypeLabel: string;
  /** Pre-formatted date range, e.g. "Tue 10/06 – Sat 14/06" (or a single day). */
  dateRangeText: string;
  approved: boolean;
}): OutgoingEmail {
  const { businessName, staffName, leaveTypeLabel, dateRangeText, approved } =
    input;
  const outcome = approved ? "approved" : "not approved";
  const subject = `Your leave request for ${dateRangeText} was ${approved ? "approved" : "declined"} — ${businessName}`;
  const followUp = approved
    ? "Enjoy your time off!"
    : "If you have questions, please speak to your manager.";
  return {
    to: "",
    subject,
    html: layout({
      heading: `Hi ${staffName},`,
      bodyHtml: `<p>Your ${leaveTypeLabel.toLowerCase()} request for <strong>${dateRangeText}</strong> has been <strong>${outcome}</strong> by ${businessName}.</p><p>${followUp}</p>`,
      footer: "Questions about your leave? Reply to your manager directly.",
    }),
    text: [
      `Hi ${staffName},`,
      "",
      `Your ${leaveTypeLabel.toLowerCase()} request for ${dateRangeText} has been ${outcome} by ${businessName}.`,
      "",
      followUp,
    ].join("\n"),
  };
}

export function shiftClaimApprovedEmail(input: {
  businessName: string;
  staffName: string;
  /** "Mon 10/06" */
  dayText: string;
  /** Shift label, e.g. "Morning". */
  label: string;
  /** "9:00 am – 12:00 pm" */
  timeText: string;
}): OutgoingEmail {
  const { businessName, staffName, dayText, label, timeText } = input;
  return {
    to: "",
    subject: `You're confirmed for ${label} on ${dayText} — ${businessName}`,
    html: layout({
      heading: `Hi ${staffName},`,
      bodyHtml: `<p>Good news — your manager approved your claim. You're now confirmed for:</p><p style="margin:12px 0;"><strong>${dayText}</strong> — ${label}, ${timeText}</p><p>See you then!</p>`,
      footer: "Questions about this shift? Reply to your manager directly.",
    }),
    text: [
      `Hi ${staffName},`,
      "",
      `Your manager approved your claim. You're now confirmed for:`,
      `  • ${dayText} — ${label}, ${timeText}`,
      "",
      "See you then!",
    ].join("\n"),
  };
}

export function shiftCoveredEmail(input: {
  businessName: string;
  staffName: string;
  coveredByName: string;
  dayText: string;
  label: string;
  timeText: string;
}): OutgoingEmail {
  const { businessName, staffName, coveredByName, dayText, label, timeText } =
    input;
  return {
    to: "",
    subject: `Your ${label} on ${dayText} is now covered — ${businessName}`,
    html: layout({
      heading: `Hi ${staffName},`,
      bodyHtml: `<p>The shift you offered up is now covered by <strong>${coveredByName}</strong>:</p><p style="margin:12px 0;"><strong>${dayText}</strong> — ${label}, ${timeText}</p><p>You're no longer rostered on for it.</p>`,
      footer: "Questions? Reply to your manager directly.",
    }),
    text: [
      `Hi ${staffName},`,
      "",
      `The shift you offered up is now covered by ${coveredByName}:`,
      `  • ${dayText} — ${label}, ${timeText}`,
      "",
      "You're no longer rostered on for it.",
    ].join("\n"),
  };
}

export function certificationReminderEmail(input: {
  businessName: string;
  items: Array<{
    staffName: string;
    certName: string;
    /** "expires in 7 days" / "expires today" / "expired 3 days ago" */
    phrase: string;
    /** "Mon 09/06" */
    expiryText: string;
  }>;
}): OutgoingEmail {
  const { businessName, items } = input;
  const n = items.length;
  const countText = `${n} certification${n === 1 ? "" : "s"}`;

  const listHtml = `<ul style="padding-left:18px;margin:12px 0;">${items
    .map(
      (i) =>
        `<li style="margin:4px 0;"><strong>${i.staffName}</strong> — ${i.certName} ${i.phrase} (${i.expiryText})</li>`,
    )
    .join("")}</ul>`;

  const listText = items
    .map(
      (i) => `  • ${i.staffName} — ${i.certName} ${i.phrase} (${i.expiryText})`,
    )
    .join("\n");

  return {
    to: "",
    subject: `${countText} need attention — ${businessName}`,
    html: layout({
      heading: "Certifications to check",
      bodyHtml: `<p>${countText} for your team ${n === 1 ? "is" : "are"} expiring soon or have expired:</p>${listHtml}<p>Update them in your roster tool under Certifications.</p>`,
      footer:
        "You're getting this because you manage this business. We send one reminder per stage (early, final, and on expiry).",
    }),
    text: [
      "Certifications to check",
      "",
      `${countText} for your team need attention:`,
      "",
      listText,
      "",
      "Update them in your roster tool under Certifications.",
    ].join("\n"),
  };
}

export function orderReminderEmail(input: {
  businessName: string;
  suppliers: Array<{
    supplierName: string;
    /** "Mon 08/06" — the upcoming delivery this order is for. */
    deliveryText: string;
    needsOrder: Array<{ name: string; quantity?: string | null }>;
    low: Array<{ name: string; quantity?: string | null }>;
  }>;
}): OutgoingEmail {
  const { businessName, suppliers } = input;
  const n = suppliers.length;
  const countText = `${n} supplier${n === 1 ? "" : "s"}`;

  const itemText = (i: { name: string; quantity?: string | null }) =>
    i.quantity ? `${i.name} (${i.quantity} left)` : i.name;

  const blockHtml = suppliers
    .map((s) => {
      const lines = [
        s.needsOrder.length
          ? `<p style="margin:6px 0;"><strong>Need to order:</strong> ${s.needsOrder
              .map(itemText)
              .join(", ")}</p>`
          : "",
        s.low.length
          ? `<p style="margin:6px 0;"><strong>Running low:</strong> ${s.low
              .map(itemText)
              .join(", ")}</p>`
          : "",
      ].join("");
      return `<div style="margin:16px 0;padding:12px 14px;border:1px solid #d1d5db;border-radius:8px;">
        <p style="margin:0 0 4px;font-weight:700;">Order from ${s.supplierName} before ${s.deliveryText}</p>
        ${lines}
      </div>`;
    })
    .join("");

  const blockText = suppliers
    .map((s) => {
      const parts = [`Order from ${s.supplierName} before ${s.deliveryText}`];
      if (s.needsOrder.length)
        parts.push(`  Need to order: ${s.needsOrder.map(itemText).join(", ")}`);
      if (s.low.length)
        parts.push(`  Running low: ${s.low.map(itemText).join(", ")}`);
      return parts.join("\n");
    })
    .join("\n\n");

  return {
    to: "",
    subject: `Order reminder — ${businessName}: ${countText} to order`,
    html: layout({
      heading: "Stock to order",
      bodyHtml: `<p>Based on your latest stock checks, ${countText} ${
        n === 1 ? "has" : "have"
      } items to order before their next delivery:</p>${blockHtml}<p>Review and update stock in your roster tool under Stock.</p>`,
      footer:
        "You're getting this because you manage this business. We send one reminder per supplier on its order-by day. This is a reminder only — we don't place orders.",
    }),
    text: [
      "Stock to order",
      "",
      `${countText} to order before their next delivery:`,
      "",
      blockText,
      "",
      "Review and update stock in your roster tool under Stock.",
    ].join("\n"),
  };
}

export function reminderEmail(input: {
  businessName: string;
  staffName: string;
  periodLabel: string;
  link: string;
  deadlineText?: string;
}): OutgoingEmail {
  const { businessName, staffName, periodLabel, link, deadlineText } = input;
  const deadlineLine = deadlineText
    ? `We need your answer by <strong>${deadlineText}</strong>.`
    : "We're still waiting to hear from you.";
  const deadlineText2 = deadlineText
    ? `We need your answer by ${deadlineText}.`
    : "We're still waiting to hear from you.";
  return {
    to: "",
    subject: `Reminder — ${businessName}: when can you work for "${periodLabel}"?`,
    html: layout({
      heading: `Hi ${staffName},`,
      bodyHtml: `<p>Just a quick reminder to let ${businessName} know your availability for <strong>${periodLabel}</strong>. ${deadlineLine}</p>`,
      ctaLabel: "Choose my shifts",
      ctaUrl: link,
      footer:
        "This link is just for you. Please don't forward it. It works once and expires.",
    }),
    text: [
      `Hi ${staffName},`,
      "",
      `Just a reminder to let ${businessName} know your availability for "${periodLabel}".`,
      deadlineText2,
      "",
      `Open this link to choose your shifts:`,
      link,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Daily digest of NEW form responses (M35) — one consolidated email per
 * business per day, sent only when something arrived. PRIVACY: counts + form
 * titles + links ONLY — never answer content and never a respondent identity
 * (identical wording for public, attributed and anonymous responses).
 */
export function formResponseDigestEmail(input: {
  businessName: string;
  items: Array<{
    title: string;
    count: number;
    /** Absolute link to that form's responses page. */
    url: string;
  }>;
}): OutgoingEmail {
  const { businessName, items } = input;
  const total = items.reduce((sum, i) => sum + i.count, 0);
  const countText = `${total} new form response${total === 1 ? "" : "s"}`;

  const listHtml = `<ul style="padding-left:18px;margin:12px 0;">${items
    .map(
      (i) =>
        `<li style="margin:4px 0;"><a href="${i.url}" style="font-weight:700;">${i.title}</a> — ${i.count} new response${i.count === 1 ? "" : "s"}</li>`,
    )
    .join("")}</ul>`;

  const listText = items
    .map(
      (i) =>
        `  • ${i.title} — ${i.count} new response${i.count === 1 ? "" : "s"}\n    ${i.url}`,
    )
    .join("\n");

  return {
    to: "",
    subject: `${countText} — ${businessName}`,
    html: layout({
      heading: "New form responses",
      bodyHtml: `<p>Since your last digest, your forms received ${countText}:</p>${listHtml}<p>Open a form to read the answers.</p>`,
      footer:
        "You're getting this because you manage this business. One summary per day, only on days with new responses — turn it off under Settings → Notifications.",
    }),
    text: [
      "New form responses",
      "",
      `Since your last digest, your forms received ${countText}:`,
      "",
      listText,
      "",
      "Open a form to read the answers.",
    ].join("\n"),
  };
}
