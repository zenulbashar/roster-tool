/**
 * HTTP security headers (SEC-05) and indexing controls for the public
 * capability pages (SEC-08). Pure data, imported by `next.config.ts` and
 * unit-tested so the set can never silently regress.
 *
 * - HSTS: always HTTPS after first contact (preload-ready).
 * - nosniff: the clock-photo and CSV routes serve user-supplied bytes.
 * - Referrer-Policy: never leak a capability slug (/r, /f, /a, /me, /kiosk,
 *   /clock) in the Referer header of an outbound click.
 * - Permissions-Policy: camera (kiosk clock-in photos) and geolocation
 *   (personal-phone GPS clock-in) are genuinely needed, same-origin only;
 *   everything else is denied.
 * - frame-ancestors 'none': the impersonation safety framing is VISUAL (a red
 *   banner + inset frame), so a clickjacked owner surface would defeat it.
 * - CSP ships REPORT-ONLY first. Expected violations to triage before
 *   enforcing: inline styles, the Google Fonts links, the Turnstile widget.
 */

export type Header = { key: string; value: string };

/** Origins the app legitimately loads from (see src/app/layout.tsx). */
export const CSP_ORIGINS = {
  turnstile: "https://challenges.cloudflare.com",
  fontsCss: "https://fonts.googleapis.com",
  fontsFiles: "https://fonts.gstatic.com",
} as const;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // 'unsafe-inline' for scripts is a report-only compromise until the
  // Turnstile mount and Next's inline runtime carry a nonce.
  `script-src 'self' 'unsafe-inline' ${CSP_ORIGINS.turnstile}`,
  `style-src 'self' 'unsafe-inline' ${CSP_ORIGINS.fontsCss}`,
  `font-src 'self' ${CSP_ORIGINS.fontsFiles}`,
  // data: for the server-rendered QR; blob: for the kiosk webcam capture.
  "img-src 'self' data: blob:",
  `frame-src ${CSP_ORIGINS.turnstile}`,
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Applied to every route. */
export const SECURITY_HEADERS: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY,
  },
];

/**
 * Public capability pages: /r (staff names + shift times), /f (public forms),
 * /a (availability). Slug/token entropy is their only access control, so they
 * must never be indexed and must not leak their URL in a Referer.
 */
export const CAPABILITY_PAGE_HEADERS: Header[] = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

/** Next.js route-matcher sources for the capability pages. */
export const CAPABILITY_PAGE_SOURCES = [
  "/r/:path*",
  "/f/:path*",
  "/a/:path*",
  "/me/:path*",
  "/kiosk/:path*",
  "/clock/:path*",
] as const;

/** `robots.txt` disallow list — nothing under these is for crawlers. */
export const ROBOTS_DISALLOW = [
  "/app",
  "/admin",
  "/api",
  "/kiosk",
  "/clock",
  "/me",
  "/r",
  "/f",
  "/a",
  "/onboarding",
  "/sign-in",
  "/xero",
] as const;
