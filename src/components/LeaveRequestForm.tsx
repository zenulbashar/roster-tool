"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { LeaveSubmitResult } from "@/lib/leave-submission";
import { Banner, Button, Card } from "@/components/ui";

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
    return (
      <Card className="mt-8 text-center">
        <p className="text-xl font-bold">{state.message}</p>
        <Link
          href={backHref}
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--color-brand)] px-6 py-3 text-base font-semibold text-[var(--color-brand-ink)]"
        >
          Done
        </Link>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <h1 className="text-2xl font-bold">Request leave</h1>
      <p className="mt-1 text-[var(--color-muted)]">
        {staffName}, ask {""}your manager for time off. They&apos;ll approve or
        decline it.
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Type</span>
          <select
            name="leaveType"
            defaultValue="annual"
            aria-label="Leave type"
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
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
            <span className="mb-1 block text-sm font-semibold">First day</span>
            <input
              type="date"
              name="startDate"
              required
              className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-sm font-semibold">Last day</span>
            <input
              type="date"
              name="endDate"
              required
              className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">
            Note (optional)
          </span>
          <input
            name="note"
            maxLength={500}
            placeholder="e.g. Family wedding"
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-base"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Your PIN</span>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4}"
            maxLength={4}
            required
            placeholder="••••"
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-center text-2xl tracking-[0.5em]"
            aria-label="Your 4-digit PIN"
          />
        </label>
        <div className="flex gap-3">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? "Sending…" : "Send request"}
          </Button>
          <Link
            href={backHref}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 text-base font-semibold"
          >
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
