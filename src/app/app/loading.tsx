import { PageSkeleton } from "@/components/Skeleton";

/**
 * Owner-area route loading state (PERF-09): on a navigation the chrome paints
 * at once and this skeleton stands in for the page body until its data
 * resolves, instead of a blank tab then everything at once.
 */
export default function OwnerLoading() {
  return <PageSkeleton />;
}
