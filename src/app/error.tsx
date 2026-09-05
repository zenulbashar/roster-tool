"use client";

import { ErrorState } from "@/components/ErrorState";

/**
 * Root-segment error boundary (PERF-09): every route under the root layout
 * that has no closer boundary — the marketing page, sign-in, onboarding, the
 * staff surfaces (/kiosk, /clock, /me, /a, /r, /f) and the public form. Bare
 * card on the green wash, matching the sign-in surfaces.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState bare digest={error.digest} reset={reset} />;
}
