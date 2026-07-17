"use client";

import { useState } from "react";
import { enterImpersonation } from "@/app/admin/actions";

/**
 * "View as venue" entry point + red-headed confirm modal (M37). The modal spells
 * out that impersonation is FULL read/write to the client's LIVE account and
 * that a red banner stays up the whole time — the wording is the safety feature,
 * so it is built faithfully. Confirm posts the orgId to `enterImpersonation`,
 * which sets the signed cookie and drops the admin into the owner app.
 */
export function ImpersonationEntryModal({
  orgId,
  venueName,
  variant = "row",
}: {
  orgId: string;
  venueName: string;
  variant?: "row" | "primary";
}) {
  const [open, setOpen] = useState(false);

  const trigger =
    variant === "primary" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-archivo inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[#312E81] px-[17px] py-[11px] text-[13.5px] font-bold text-white shadow-[0_1px_2px_rgba(17,24,39,0.10)] transition-colors hover:bg-[#4338CA]"
      >
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[18px]"
        >
          visibility
        </span>
        View as venue
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#312E81] px-[12px] py-[7px] text-[12.5px] font-semibold text-white transition-colors hover:bg-[#4338CA]"
      >
        <span
          aria-hidden="true"
          className="material-symbols-rounded text-[16px]"
        >
          visibility
        </span>
        View as
      </button>
    );

  return (
    <>
      {trigger}
      {open ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 [animation:rosterFade_0.14s_ease]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="imp-entry-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-[460px] overflow-hidden rounded-[16px] bg-white shadow-[0_30px_70px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2.5 bg-[#B91C1C] px-[22px] py-[16px] text-white">
              <span
                aria-hidden="true"
                className="material-symbols-rounded text-[22px]"
              >
                visibility
              </span>
              <h2
                id="imp-entry-title"
                className="font-archivo text-[16px] font-bold"
              >
                View as venue — live account
              </h2>
            </div>
            <div className="px-[22px] py-[18px]">
              <p className="text-[13.5px] leading-relaxed text-[#374151]">
                You&rsquo;re about to enter <strong>{venueName}</strong> and act
                as their venue. You&rsquo;ll have{" "}
                <strong>full read and write access</strong> to their live
                account — including rosters, staff pay-rate inputs and Xero
                mappings.
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-[#374151]">
                Anything you change saves to their real data. A red banner will
                stay on screen the whole time so you don&rsquo;t forget.
              </p>
              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[10px] border border-[var(--color-border)] bg-white px-[15px] py-[10px] text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[var(--color-bg)]"
                >
                  Cancel
                </button>
                <form action={enterImpersonation}>
                  <input type="hidden" name="orgId" value={orgId} />
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#B91C1C] px-[16px] py-[11px] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#991B1B]"
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-rounded text-[18px]"
                    >
                      visibility
                    </span>
                    Enter live account
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
