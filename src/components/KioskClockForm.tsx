"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { clockAction, type ClockResult } from "@/app/kiosk/actions";
import { Banner } from "@/components/ui";

const initial: ClockResult = { status: "idle" };

/**
 * Kiosk clock in/out for one staff member: PIN entry plus, when the business has
 * it switched on, a webcam still captured at submit. Camera trouble never blocks
 * clocking — we show a note and fall back to PIN only.
 */
export function KioskClockForm({
  staffId,
  staffName,
  currentlyIn,
  requirePhoto,
}: {
  staffId: string;
  staffName: string;
  currentlyIn: boolean;
  requirePhoto: boolean;
}) {
  const [state, formAction, pending] = useActionState(clockAction, initial);
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!requirePhoto) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setCameraReady(true);
      })
      .catch(() => setCameraError(true));
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [requirePhoto]);

  // Release the camera once we've successfully clocked.
  useEffect(() => {
    if (state.status === "success") stopCamera();
  }, [state.status]);

  // Grab a frame just before the form submits, into the hidden field.
  const captureFrame = () => {
    if (!photoRef.current) return;
    const video = videoRef.current;
    if (!cameraReady || !video || video.videoWidth === 0) {
      photoRef.current.value = "";
      return;
    }
    const width = Math.min(640, video.videoWidth);
    const height = (video.videoHeight / video.videoWidth) * width;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      photoRef.current.value = "";
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    photoRef.current.value = canvas.toDataURL("image/jpeg", 0.6);
  };

  if (state.status === "success") {
    return (
      <div className="w-full rounded-[22px] border border-[#166534] bg-[#14532D] p-10 text-center">
        <div className="mx-auto mb-[18px] flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#5FA875]">
          <span className="material-symbols-rounded fill text-[42px] text-[#111827]">
            check
          </span>
        </div>
        <p className="font-archivo text-[22px] font-extrabold text-white">
          {state.message}
        </p>
        <Link
          href="/kiosk"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[12px] bg-white px-8 py-3 font-archivo text-[15px] font-bold text-[#111827]"
        >
          Done
        </Link>
      </div>
    );
  }

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

      {requirePhoto ? (
        <div className="mt-4">
          {cameraError ? (
            <Banner tone="info">
              Camera unavailable — you can still clock{" "}
              {currentlyIn ? "out" : "in"} with your PIN.
            </Banner>
          ) : (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                className="aspect-video w-full rounded-[12px] bg-black"
              />
              <p className="mt-1 text-center text-[12px] text-[#6B7280]">
                A photo is taken when you clock in or out.
              </p>
            </>
          )}
        </div>
      ) : null}

      <form action={formAction} className="mt-5 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <input type="hidden" name="photo" ref={photoRef} />
        <label className="block">
          <span className="mb-1.5 block text-center text-[13px] font-semibold text-[#CBD5E1]">
            Your PIN
          </span>
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
            className="block w-full rounded-[14px] border border-[#2A3344] bg-[#0E1320] px-4 py-4 text-center font-archivo text-3xl tracking-[0.5em] text-white outline-none placeholder:text-[#4B5563] focus:border-[#5FA875]"
            aria-label="Your 4-digit PIN"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          onClick={captureFrame}
          className="flex w-full items-center justify-center gap-2.5 rounded-[18px] bg-[#5FA875] px-6 py-5 font-archivo text-[19px] font-extrabold text-[#111827] hover:bg-[#4E9666] disabled:opacity-60"
        >
          <span className="material-symbols-rounded text-[26px]">
            {currentlyIn ? "logout" : "login"}
          </span>
          {pending ? "Please wait…" : currentlyIn ? "Clock Out" : "Clock In"}
        </button>
        <Link
          href="/kiosk"
          className="block text-center text-[13px] font-semibold text-[#6B7280] hover:text-[#9CA3AF]"
        >
          ← Not you? Start over
        </Link>
      </form>
    </div>
  );
}
