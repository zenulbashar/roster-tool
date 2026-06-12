import type { ReactNode } from "react";

/**
 * "Which account am I in?" context, shown on onboarding and in Settings.
 *
 * Pure presentational: the email/business name MUST come from the
 * authenticated server-side session (never client input) — the pages pass
 * them in. Renders nothing when no email is available, so a missing email
 * can never break the page around it.
 */
export function AccountIdentity({
  email,
  lead = "Signed in as",
  businessName,
  hint,
  children,
}: {
  email: string | null;
  /** Lead-in before the email, e.g. "You're signed in as" on onboarding. */
  lead?: string;
  /** Shown as a second "Business: …" line (Settings). */
  businessName?: string;
  /** Extra explanatory copy under the email line (onboarding). */
  hint?: string;
  /** Optional action slot, e.g. a sign-out form (onboarding). */
  children?: ReactNode;
}) {
  if (!email) return null;
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-sm">
      <p>
        {lead} <strong className="font-semibold">{email}</strong>
      </p>
      {businessName ? (
        <p className="mt-1">
          Business: <strong className="font-semibold">{businessName}</strong>
        </p>
      ) : null}
      {hint ? <p className="mt-2 text-[var(--color-muted)]">{hint}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
