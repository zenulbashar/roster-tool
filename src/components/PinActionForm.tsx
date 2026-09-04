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
 * action (each resolves the business from its own capability token), the
 * acting staff member, a single hidden id, and the display details.
 * PIN-authed, no location check.
 *
 * The shared PIN core (`authenticateStaffPinFromForm`) reads exactly two
 * fields — `staffId` and `pin` — so this form MUST post both; the staff id is
 * the person the kiosk/phone screen already selected (never typed), and the
 * PIN proves it is them. `choice` renders one optional yes/no box beside the
 * PIN (PROD-15: "let staff at my other locations cover it").
 */
export function PinActionForm({
  action,
  heading,
  details,
  staffId,
  hiddenName,
  hiddenValue,
  submitLabel,
  backHref,
  choice,
}: {
  action: (
    prev: ShiftActionResult,
    formData: FormData,
  ) => Promise<ShiftActionResult>;
  heading: string;
  details: ReactNode;
  /** The selected staff member — posted as `staffId` for the PIN core. */
  staffId: string;
  hiddenName: string;
  hiddenValue: string;
  submitLabel: string;
  backHref: string;
  /** An optional checkbox posted as `<name>=1` when ticked. */
  choice?: {
    name: string;
    label: string;
    hint?: string;
    defaultChecked?: boolean;
  };
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
          <Banner tone="error">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <input type="hidden" name={hiddenName} value={hiddenValue} />
        {choice ? (
          <label className="flex items-start gap-3 rounded-[12px] border border-[#2A3344] bg-[#0E1320] px-4 py-3">
            <input
              type="checkbox"
              name={choice.name}
              value="1"
              defaultChecked={choice.defaultChecked ?? false}
              className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[#5FA875]"
            />
            <span>
              <span className="block text-[14px] font-semibold text-white">
                {choice.label}
              </span>
              {choice.hint ? (
                <span className={`block text-[13px] ${kioskCls.muted}`}>
                  {choice.hint}
                </span>
              ) : null}
            </span>
          </label>
        ) : null}
        <label className="block">
          <span className={kioskCls.label}>Your PIN</span>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4,6}"
            maxLength={6}
            required
            autoFocus
            placeholder="••••"
            className={kioskCls.pin}
            aria-label="Your PIN"
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
