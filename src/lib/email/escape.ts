import { env } from "@/lib/env";

/**
 * HTML escaping for outbound email (SEC-16).
 *
 * Every `${…}` interpolated into an email's HTML body MUST go through `esc`.
 * The templates are plain string concatenation, so nothing escapes by default;
 * fields like a business name, a period label, a shift label — and, crucially,
 * STAFF-entered text such as a stock-check quantity — would otherwise land in
 * the recipient's mail client as live markup. Because these emails come from
 * Roster's own DKIM-signed domain, an injected link is a maximally credible
 * phish (the classic "update your supplier's bank details"). The plain-text
 * variants are unaffected and need no escaping.
 */
export function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A call-to-action href must be one of OURS. Every CTA in the app is built
 * server-side from `env.APP_URL`, so anything else is a bug or an injection;
 * fall back to the app root rather than emit an attacker-chosen destination.
 * The result is also attribute-escaped.
 */
export function safeCtaUrl(url: string): string {
  return esc(url.startsWith(`${env.APP_URL}/`) ? url : env.APP_URL);
}
