import Link from "next/link";

/**
 * The branded "not found" panel every `not-found.tsx` renders (PERF-09 /
 * UX-01). Plain language, one way back. Rendered inside the surviving layout
 * (owner/admin chrome) or bare for a root miss. A server component — nothing
 * here needs the client.
 */
export function NotFoundState({
  title = "We couldn't find that page",
  description = "The link may be out of date, or the page may have moved.",
  homeHref = "/",
  homeLabel = "Go to the home page",
  bare = false,
}: {
  title?: string;
  description?: string;
  homeHref?: string;
  homeLabel?: string;
  bare?: boolean;
}) {
  const panel = (
    <div className="rounded-[18px] border border-[#E5E7EB] bg-white p-[30px] shadow-[0_8px_30px_rgba(17,24,39,0.07)]">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[11px] bg-[#F3F4F6] text-[#6B7280]"
        >
          <span className="material-symbols-rounded text-[24px]">
            search_off
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-archivo text-[22px] font-extrabold tracking-[-0.01em] text-[#111827]">
            {title}
          </h1>
          <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4B5563]">
            {description}
          </p>
          <div className="mt-5">
            <Link
              href={homeHref}
              className="inline-flex min-h-11 items-center justify-center rounded-[11px] bg-[#13301F] px-[17px] py-[11px] font-archivo text-[13.5px] font-bold text-white hover:bg-[#1D4A2E]"
            >
              {homeLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  if (!bare) return panel;
  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 50% 0, #ECF3EE, #F9FAFB 60%)",
      }}
    >
      <div className="w-full max-w-[560px]">{panel}</div>
    </main>
  );
}
