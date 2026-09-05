"use client";

import { ErrorState } from "@/components/ErrorState";

/**
 * Owner-area error boundary (PERF-09). A page that throws renders this INSIDE
 * the owner chrome — the nav, location switcher and bell stay up, so the owner
 * can move on to another page or retry this one.
 */
export default function OwnerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page hit a problem"
      description="This has been recorded and we'll look into it. Try again, or head back to your dashboard — nothing you'd already saved is lost."
      digest={error.digest}
      reset={reset}
      homeHref="/app"
      homeLabel="Back to dashboard"
    />
  );
}
