"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { LeaveSubmitResult } from "@/lib/leave-submission";
import { Banner } from "@/components/ui";
import { kioskCls, KioskSuccess } from "@/components/KioskForm";

const initial: LeaveSubmitResult = { status: "idle" };

const LEAVE_TYPES = [
  { value: "annual", label: "Annual leave" },
  { value: "sick", label: "Sick leave" },
  { value: "unpaid", label: "Unpaid leave" },
  { value: "other", label: "Other" },
] as const;

/**
 * Staff leave-request form, shared by the personal-phone (`/clock`) and kiosk
 * (`/kiosk`) flows. The page passes the relevant server action (each resolves
 * the business from its own capability token) plus the back link. PIN-authed,
 * no location check.
 */
export function LeaveRequestForm({
  action,
  staffId,
  staffName,
  backHref,
}: {
  action: (
    prev: LeaveSubmitResult,
    formData: FormData,
  ) => Promise<LeaveSubmitResult>;
  staffId: string;
  staffName: string;
  backHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.status === "success") {
    return <KioskSuccess message={state.message} backHref={backHref} />;
  }

  return (
    <div className={`mt-2 ${kioskCls.card}`}>
      <h1 className={kioskCls.heading}>Request leave</h1>
      <p className={kioskCls.sub}>
        {staffName}, ask your manager for time off. They&apos;ll approve or
        decline it.
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <label className="block">
          <span className={kioskCls.label}>Type</span>
          <select
            name="leaveType"
            defaultValue="annual"
            aria-label="Leave type"
            className={kioskCls.input}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className={kioskCls.label}>First day</span>
            <input
              type="date"
              name="startDate"
              required
              className={kioskCls.input}
            />
          </label>
          <label className="block flex-1">
            <span className={kioskCls.label}>Last day</span>
            <input
              type="date"
              name="endDate"
              required
              className={kioskCls.input}
            />
          </label>
        </div>
        <label className="block">
          <span className={kioskCls.label}>Note (optional)</span>
          <input
            name="note"
            maxLength={500}
            placeholder="e.g. Family wedding"
            className={kioskCls.input}
          />
        </label>
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
            placeholder="••••"
            className={kioskCls.pin}
            aria-label="Your 4-digit PIN"
          />
        </label>
        <div className="flex gap-3">
          <button type="submit" disabled={pending} className={kioskCls.primary}>
            {pending ? "Sending…" : "Send request"}
          </button>
          <Link href={backHref} className={kioskCls.cancel}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
