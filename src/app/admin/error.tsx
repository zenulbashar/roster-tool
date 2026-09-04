"use client";

import { ErrorState } from "@/components/ErrorState";

/** Admin-console error boundary (PERF-09) — inside the indigo chrome. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="This page hit a problem"
      description="This has been recorded. Try again, or go back to the clients list."
      digest={error.digest}
      reset={reset}
      homeHref="/admin/clients"
      homeLabel="Back to clients"
    />
  );
}
