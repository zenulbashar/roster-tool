"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import type { ShiftActionResult } from "@/lib/shift-offer-submission";
import { Banner } from "@/components/ui";
import { kioskCls, KioskSuccess } from "@/components/KioskForm";

const initial: ShiftActionResult = { status: "idle" };

/**
 * A single confirm-with-PIN action, shared by the staff release / claim /
 * cancel sub-views on both clock surfaces. The page passes the relevant server
 * action (each resolves the business from its own capability token), a single
 * hidden id, and the display details. PIN-authed, no location check.
 */
export function PinActionForm({
  action,
  heading,
  details,
  hiddenName,
  hiddenValue,
  submitLabel,
  backHref,
}: {
  action: (
    prev: ShiftActionResult,
    formData: FormData,
  ) => Promise<ShiftActionResult>;
  heading: string;
  details: ReactNode;
  hiddenName: string;
  hiddenValue: string;
  submitLabel: string;
  backHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.status === "success") {
    return <KioskSuccess message={state.message} backHref={backHref} />;
  }

  return (
    <div className={`mt-2 ${kioskCls.card}`}>
      <h1 className={kioskCls.heading}>{heading}</h1>
      <div className={`mt-2 text-[14px] ${kioskCls.muted}`}>{details}</div>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name={hiddenName} value={hiddenValue} />
        <label className="block">
          <span className={kioskCls.label}>Your PIN</span>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4}"
            maxLength={4}
            required
            autoFocus
            placeholder="••••"
            className={kioskCls.pin}
            aria-label="Your 4-digit PIN"
          />
        </label>
        <div className="flex gap-3">
          <button type="submit" disabled={pending} className={kioskCls.primary}>
            {pending ? "Please wait…" : submitLabel}
          </button>
          <Link href={backHref} className={kioskCls.cancel}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
