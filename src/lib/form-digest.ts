/**
 * Daily form-response email digest (M35) — the email phase M23 deferred.
 * Pure helpers for the sweep in handlers.ts.
 *
 * PRIVACY: a digest carries COUNTS + form TITLES + links ONLY — never answer
 * content and never a respondent identity, exactly mirroring the in-app bell
 * (so the wording is identical for public, attributed and anonymous
 * responses). One consolidated email per business per day, and only on days
 * that actually had new responses — owners with quiet forms hear nothing.
 */

/** New-response tally for one form, as the digest reports it. */
export type FormDigestItem = {
  formId: string;
  title: string;
  count: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where this sweep's counting window starts: the cursor from the last
 * successful send, or — when the business has never been sent a digest —
 * the last 24 hours, so a rollout never emails months of historic counts.
 */
export function digestWindowStart(lastAt: Date | null, now: Date): Date {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  return lastAt ?? dayAgo;
}

/** "14 new form responses" / "1 new form response". */
export function digestSummary(items: FormDigestItem[]): string {
  const total = items.reduce((sum, i) => sum + i.count, 0);
  return `${total} new form response${total === 1 ? "" : "s"}`;
}

/** Sorted copy for stable output: busiest form first, ties by title. */
export function orderDigestItems(items: FormDigestItem[]): FormDigestItem[] {
  return [...items].sort(
    (a, b) => b.count - a.count || a.title.localeCompare(b.title),
  );
}
