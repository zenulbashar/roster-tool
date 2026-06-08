"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import type { ShiftActionResult } from "@/lib/shift-offer-submission";
import { Banner, Button, Card } from "@/components/ui";

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
      <h1 className="text-2xl font-bold">{heading}</h1>
      <div className="mt-2 text-[var(--color-muted)]">{details}</div>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name={hiddenName} value={hiddenValue} />
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
            autoFocus
            placeholder="••••"
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-center text-2xl tracking-[0.5em]"
            aria-label="Your 4-digit PIN"
          />
        </label>
        <div className="flex gap-3">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? "Please wait…" : submitLabel}
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
