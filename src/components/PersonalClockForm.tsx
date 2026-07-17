"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { personalClockAction, type ClockResult } from "@/app/clock/actions";
import { Banner } from "@/components/ui";

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
      <div className="mt-2 w-full rounded-[22px] border border-[#166534] bg-[#14532D] p-10 text-center">
        <div className="mx-auto mb-[18px] flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#5FA875]">
          <span className="material-symbols-rounded fill text-[42px] text-[#111827]">
            check
          </span>
        </div>
        <p className="font-archivo text-[22px] font-extrabold text-white">
          {state.message}
        </p>
        <Link
          href="/clock"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[12px] bg-white px-8 py-3 font-archivo text-[15px] font-bold text-[#111827]"
        >
          Done
        </Link>
      </div>
    );
  }

  const busy = pending || locating;

  return (
    <div className="w-full rounded-[18px] border border-[#2A3344] bg-[#1C2433] p-6">
      <div className="text-center">
        <h1 className="font-archivo text-[22px] font-extrabold text-white">
          Hi {staffName.split(" ")[0]} 👋
        </h1>
        <p className="mt-1 text-[14px] text-[#9CA3AF]">
          {currentlyIn ? "You're clocked in." : "Enter your PIN to clock in."}
        </p>
      </div>

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

      <form ref={formRef} action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <input type="hidden" name="lat" ref={latRef} />
        <input type="hidden" name="lng" ref={lngRef} />
        <label className="block">
          <span className="mb-1.5 block text-center text-[13px] font-semibold text-[#CBD5E1]">
            Your PIN
          </span>
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
            className="block w-full rounded-[14px] border border-[#2A3344] bg-[#0E1320] px-4 py-4 text-center font-archivo text-3xl tracking-[0.5em] text-white outline-none placeholder:text-[#4B5563] focus:border-[#5FA875]"
            aria-label="Your 4-digit PIN"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={clockNow}
          className="flex w-full items-center justify-center gap-2.5 rounded-[18px] bg-[#5FA875] px-6 py-5 font-archivo text-[19px] font-extrabold text-[#111827] hover:bg-[#4E9666] disabled:opacity-60"
        >
          <span className="material-symbols-rounded text-[26px]">
            {currentlyIn ? "logout" : "login"}
          </span>
          {locating
            ? "Checking location…"
            : pending
              ? "Please wait…"
              : currentlyIn
                ? "Clock Out"
                : "Clock In"}
        </button>
        <Link
          href="/clock"
          className="block text-center text-[13px] font-semibold text-[#6B7280] hover:text-[#9CA3AF]"
        >
          ← Not you? Start over
        </Link>
      </form>

      <p className="mt-4 text-center text-[12px] text-[#6B7280]">
        Your location is checked when you clock in to confirm you&apos;re at
        work. It&apos;s read once, now — there&apos;s no tracking.
      </p>
    </div>
  );
}
