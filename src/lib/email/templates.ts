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
