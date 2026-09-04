"use client";

import Link from "next/link";

/**
 * The branded recovery panel every `error.tsx` boundary renders (PERF-09).
 *
 * Shows a plain-language message, the REFERENCE CODE (Next's error `digest`,
 * which the server logged alongside the request id via `onRequestError` — so
 * support can find the exact failure from what the owner reads out), a
 * "Try again" that re-renders the failed segment, and a way home. It is a
 * live region so a screen reader announces the failure where it happened.
 *
 * Kept free of app chrome and data so it can never itself fail: the panel is
 * rendered INSIDE whichever layout survived (owner/admin chrome stays up for a
 * page failure), or bare for a root failure.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "This has been recorded and we'll look into it. You can try again, or go back and carry on — nothing you'd already saved is lost.",
  digest,
  reset,
  homeHref = "/",
  homeLabel = "Go to the home page",
  bare = false,
}: {
  title?: string;
  description?: string;
  digest?: string | null;
  reset?: () => void;
  homeHref?: string;
  homeLabel?: string;
  /** Render as a centred card on the bare (no-chrome) surfaces. */
  bare?: boolean;
}) {
  const panel = (
    <div
      role="alert"
      className="rounded-[18px] border border-[#E5E7EB] bg-white p-[30px] shadow-[0_8px_30px_rgba(17,24,39,0.07)]"
    >
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[11px] bg-[#FEECEC] text-[#B91C1C]"
        >
          <span className="material-symbols-rounded text-[24px]">
            error_outline
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-archivo text-[22px] font-extrabold tracking-[-0.01em] text-[#111827]">
            {title}
          </h1>
          <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4B5563]">
            {description}
          </p>
          <p className="mt-3 text-[12.5px] text-[#6B7280]">
            Reference code:{" "}
            <code className="rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB] px-[7px] py-[2px] font-mono text-[12.5px] text-[#111827]">
              {digest || "not available"}
            </code>
            {digest ? <span> — quote this if you contact support.</span> : null}
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {reset ? (
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[11px] bg-[#13301F] px-[17px] py-[11px] font-archivo text-[13.5px] font-bold text-white hover:bg-[#1D4A2E]"
              >
                <span
                  aria-hidden="true"
                  className="material-symbols-rounded text-[18px]"
                >
                  refresh
                </span>
                Try again
              </button>
            ) : null}
            <Link
              href={homeHref}
              className="inline-flex min-h-11 items-center justify-center rounded-[11px] border border-[#D1D5DB] bg-white px-[16px] py-[10px] text-[13.5px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
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
