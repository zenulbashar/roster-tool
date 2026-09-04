/**
 * Loading skeletons for route-level `loading.tsx` files (PERF-09). Pure
 * presentation: grey blocks with the `rosterShimmer` sweep from globals.css
 * (disabled under prefers-reduced-motion with every other animation). The
 * chrome (nav, header) paints immediately from the layout; these stand in for
 * the page body while its data loads on a navigation.
 */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-[8px] ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(90deg, #EEF0F3 25%, #F7F8FA 50%, #EEF0F3 75%)",
        backgroundSize: "200% 100%",
        animation: "rosterShimmer 1.4s linear infinite",
        ...style,
      }}
    />
  );
}

/** A page header line plus three card-shaped blocks. */
export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-[28px] w-[260px]" />
      <Skeleton className="mt-2.5 h-[14px] w-[360px] max-w-full" />
      <div className="mt-6 grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
        <Skeleton className="h-[120px]" />
        <Skeleton className="h-[120px]" />
        <Skeleton className="h-[120px]" />
      </div>
      <Skeleton className="mt-4 h-[280px]" />
    </div>
  );
}
