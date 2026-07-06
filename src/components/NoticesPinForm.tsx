"use client";

import { useActionState } from "react";
import type { NoticesPinResult } from "@/app/me/actions";
import { Banner } from "@/components/ui";

const initial: NoticesPinResult = { status: "idle" };

/**
 * The /me PIN gate. The capability link said WHO this page belongs to; the
 * PIN proves it's them before anything personal is shown. On success the
 * server action sets the short-lived proof cookie and redirects back to /me.
 */
export function NoticesPinForm({
  action,
  staffName,
  businessName,
}: {
  action: (
    prev: NoticesPinResult,
    formData: FormData,
  ) => Promise<NoticesPinResult>;
  staffName: string;
  businessName: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <div className="mx-auto mt-6 max-w-[420px]">
      <div className="mb-5 flex items-center justify-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--color-ink)]"
        >
          <span className="material-symbols-rounded text-[20px] text-[var(--color-accent)]">
            grid_view
          </span>
        </span>
        <span className="font-archivo text-[20px] font-extrabold tracking-[0.05em] text-[var(--color-ink)]">
          ROSTER
        </span>
      </div>

      <div className="rounded-[18px] border border-[var(--color-border)] bg-white p-7 shadow-[0_8px_30px_rgba(17,24,39,0.07)]">
        <h1 className="text-center font-archivo text-[22px] font-extrabold text-[var(--color-ink)]">
          Hi {staffName.split(" ")[0]}
        </h1>
        <p className="mx-auto mt-2 text-center text-[14px] leading-[1.5] text-[var(--color-text-secondary)]">
          Your notices from {businessName}. Enter your PIN to open them — this
          page is just for you.
        </p>

        {state.status === "error" ? (
          <div className="mt-4">
            <Banner tone="warn">{state.message}</Banner>
          </div>
        ) : null}

        <form action={formAction} className="mt-5">
          <label
            htmlFor="notices-pin"
            className="mb-1.5 block text-center text-[13px] font-semibold text-[#374151]"
          >
            Your PIN
          </label>
          <input
            id="notices-pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4}"
            maxLength={4}
            required
            autoFocus
            placeholder="••••"
            className="block w-full rounded-[14px] border border-[var(--color-line)] bg-white px-4 py-3.5 text-center font-archivo text-3xl tracking-[0.5em] text-[var(--color-ink)] outline-none placeholder:text-[#CBD5E1] focus:border-[#76b900] focus:ring-[3px] focus:ring-[rgba(118,185,0,0.16)]"
            aria-label="Your 4-digit PIN"
          />
          <button
            type="submit"
            disabled={pending}
            className="mt-4 w-full rounded-[14px] bg-[var(--color-button)] py-3.5 font-archivo text-[15px] font-bold text-[var(--color-button-ink)] hover:bg-[var(--color-accent-dark)] disabled:opacity-60"
          >
            {pending ? "Please wait…" : "Show my notices"}
          </button>
        </form>
      </div>
    </div>
  );
}
