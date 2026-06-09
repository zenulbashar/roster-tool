"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { personalClockAction, type ClockResult } from "@/app/clock/actions";
import { Banner, Button, Card } from "@/components/ui";

const initial: ClockResult = { status: "idle" };

/**
 * Personal-phone clock in/out for one staff member: PIN entry plus a one-shot
 * location read taken at the moment of the tap (no background tracking). If the
 * browser denies location or can't get a fix, we DON'T submit — we show a clear
 * message telling them to use the in-store kiosk or ask the owner.
 */
export function PersonalClockForm({
  staffId,
  staffName,
  currentlyIn,
  locationConfigured,
}: {
  staffId: string;
  staffName: string;
  currentlyIn: boolean;
  locationConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    personalClockAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const LOCATION_DENIED =
    "We couldn't get your location. Location is required to clock in from your phone — use the in-store kiosk, or ask your manager to add your hours.";

  // Read location once, then submit. Triggered by the button (not a native
  // submit) so we can resolve coordinates first.
  const clockNow = () => {
    setGeoError(null);
    if (!pinRef.current || pinRef.current.value.length !== 4) {
      setGeoError("Enter your 4-digit PIN first.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError(LOCATION_DENIED);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current && lngRef.current) {
          latRef.current.value = String(pos.coords.latitude);
          lngRef.current.value = String(pos.coords.longitude);
        }
        setLocating(false);
        formRef.current?.requestSubmit();
      },
      () => {
        setLocating(false);
        setGeoError(LOCATION_DENIED);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  if (state.status === "success") {
    return (
      <Card className="mt-8 text-center">
        <p className="text-xl font-bold">{state.message}</p>
        <Link
          href="/clock"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--color-button)] px-6 py-3 text-base font-semibold text-[var(--color-button-ink)]"
        >
          Done
        </Link>
      </Card>
    );
  }

  const busy = pending || locating;

  return (
    <Card className="mt-6">
      <h1 className="text-2xl font-bold">{staffName}</h1>
      <p className="mt-1 text-[var(--color-muted)]">
        {currentlyIn ? "You're clocked in." : "You're not clocked in."}
      </p>

      {state.status === "error" ? (
        <div className="mt-4">
          <Banner tone="warn">{state.message}</Banner>
        </div>
      ) : null}
      {geoError ? (
        <div className="mt-4">
          <Banner tone="warn">{geoError}</Banner>
        </div>
      ) : null}
      {!locationConfigured ? (
        <div className="mt-4">
          <Banner tone="info">
            Phone clock-in isn&apos;t set up yet — ask your manager to set the
            shop location.
          </Banner>
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <input type="hidden" name="lat" ref={latRef} />
        <input type="hidden" name="lng" ref={lngRef} />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Your PIN</span>
          <input
            ref={pinRef}
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
          <Button
            type="button"
            disabled={busy}
            onClick={clockNow}
            className="flex-1"
          >
            {locating
              ? "Checking location…"
              : pending
                ? "Please wait…"
                : currentlyIn
                  ? "Clock out"
                  : "Clock in"}
          </Button>
          <Link
            href="/clock"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 text-base font-semibold"
          >
            Cancel
          </Link>
        </div>
      </form>

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        Your location is checked when you clock in to confirm you&apos;re at
        work. It&apos;s read once, now — there&apos;s no tracking.
      </p>
    </Card>
  );
}
