import { NotFoundState } from "@/components/NotFoundState";

/** Owner-area 404 — inside the chrome, one way back to the dashboard. */
export default function OwnerNotFound() {
  return (
    <NotFoundState
      description="It may have been deleted, or belong to another location — check the location switcher in the header."
      homeHref="/app"
      homeLabel="Back to dashboard"
    />
  );
}
