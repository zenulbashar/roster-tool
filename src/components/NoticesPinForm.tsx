"use client";

import { useActionState } from "react";
import type { NoticesPinResult } from "@/app/me/actions";
import { Banner, Button, Card } from "@/components/ui";

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
    <Card className="mt-6">
      <h1 className="text-2xl font-bold">Hi {staffName}</h1>
      <p className="mt-1 text-[var(--color-muted)]">
        Your notices from {businessName}. Enter your PIN to open them — this
        page is just for you.
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 space-y-4">
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
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Please wait…" : "Show my notices"}
        </Button>
      </form>
    </Card>
  );
}
