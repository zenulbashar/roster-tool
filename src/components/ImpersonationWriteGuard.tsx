"use client";

import { useEffect, useRef, useState } from "react";
import { logImpersonatedWrite } from "@/app/admin/actions";

/**
 * The write-confirm interceptor (M37). While an admin is impersonating a tenant,
 * EVERY write attempt in the page content is intercepted and must be confirmed
 * ("Save to live account") — the safety gate the design calls for.
 *
 * Implementation: a single capturing `submit` listener on the `<main>` content
 * region. Chrome forms (nav, sign-out, the exit banner, location switcher,
 * notification bell) live OUTSIDE `<main>`, so they're never intercepted — no
 * per-form annotation needed. Only POST forms (Next server actions) are caught;
 * GET forms (search/filter) pass through. On confirm we best-effort log the
 * write to the admin audit trail, then re-submit the original form.
 */
type Pending = {
  form: HTMLFormElement;
  submitter: HTMLElement | null;
  title: string;
  context: string;
};

function deriveTitle(submitter: HTMLElement | null): string {
  const text = submitter?.textContent?.trim();
  if (text && text.length <= 60) return text;
  return "Save changes";
}

export function ImpersonationWriteGuard({ venueName }: { venueName: string }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmed = useRef<WeakSet<HTMLFormElement>>(new WeakSet());

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;

    function onSubmit(e: Event) {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const method = (
        form.getAttribute("method") ||
        form.method ||
        "get"
      ).toLowerCase();
      if (method !== "post") return; // GET = search/filter, not a write
      if (form.hasAttribute("data-imp-allow")) return;
      if (confirmed.current.has(form)) {
        // Second pass after the admin confirmed — let it through.
        confirmed.current.delete(form);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitter =
        (e as SubmitEvent).submitter instanceof HTMLElement
          ? (e as SubmitEvent).submitter
          : null;
      setPending({
        form,
        submitter,
        title: form.getAttribute("data-imp-title") || deriveTitle(submitter),
        context:
          form.getAttribute("data-imp-context") ||
          `This saves to ${venueName}'s live account.`,
      });
    }

    main.addEventListener("submit", onSubmit, true);
    return () => main.removeEventListener("submit", onSubmit, true);
  }, [venueName]);

  async function onConfirm() {
    if (!pending) return;
    const { form, submitter, title, context } = pending;
    setPending(null);
    confirmed.current.add(form);
    try {
      await logImpersonatedWrite({ action: title, detail: context });
    } catch {
      // Best-effort audit — never block or divert the write.
    }
    try {
      if (submitter && "requestSubmit" in form) {
        form.requestSubmit(submitter as HTMLButtonElement);
      } else {
        form.requestSubmit();
      }
    } catch {
      form.submit();
    }
  }

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4 [animation:rosterFade_0.14s_ease]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="imp-write-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) setPending(null);
      }}
    >
      <div className="w-full max-w-[440px] overflow-hidden rounded-[16px] border-2 border-[#DC2626] bg-white shadow-[0_30px_70px_rgba(0,0,0,0.4)]">
        <div className="px-[22px] py-[18px]">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="material-symbols-rounded text-[22px] text-[#B91C1C]"
            >
              edit_note
            </span>
            <h2
              id="imp-write-title"
              className="font-archivo text-[16px] font-bold text-[var(--color-text)]"
            >
              {pending.title}
            </h2>
          </div>
          <div className="mt-3 rounded-[11px] border border-[#FECACA] bg-[#FEF2F2] px-[14px] py-[11px] text-[13px] leading-relaxed text-[#B91C1C]">
            <strong>Writing to {venueName}&rsquo;s live account.</strong>{" "}
            {pending.context}
          </div>
          <div className="mt-5 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-[10px] border border-[var(--color-border)] bg-white px-[15px] py-[10px] text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[var(--color-bg)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-[#B91C1C] px-[16px] py-[11px] text-[13.5px] font-semibold text-white transition-colors hover:bg-[#991B1B]"
            >
              <span
                aria-hidden="true"
                className="material-symbols-rounded text-[18px]"
              >
                save
              </span>
              Save to live account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
