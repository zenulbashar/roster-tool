import { NotFoundState } from "@/components/NotFoundState";

/**
 * Root 404 (PERF-09 / UX-01): an unknown URL, an expired/rotated capability
 * link, or a signed-in non-admin reaching /admin (requireAdmin calls
 * notFound() — the area doesn't exist for them, and this page gives no hint
 * that it does).
 */
export default function RootNotFound() {
  return (
    <NotFoundState
      bare
      description="The link may be out of date, or the page may have moved. If someone sent you a Roster link, ask them for a fresh one."
    />
  );
}
