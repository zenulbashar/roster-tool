"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { clockAction, type ClockResult } from "@/app/kiosk/actions";
import { Banner, Button, Card } from "@/components/ui";

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
      <Card className="mt-8 text-center">
        <p className="text-xl font-bold">{state.message}</p>
        <Link
          href="/kiosk"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--color-button)] px-6 py-3 text-base font-semibold text-[var(--color-button-ink)]"
        >
          Done
        </Link>
      </Card>
    );
  }

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
                className="aspect-video w-full rounded-lg bg-black"
              />
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                A photo is taken when you clock in or out.
              </p>
            </>
          )}
        </div>
      ) : null}

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="staffId" value={staffId} />
        <input type="hidden" name="photo" ref={photoRef} />
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
          <Button
            type="submit"
            disabled={pending}
            onClick={captureFrame}
            className="flex-1"
          >
            {pending ? "Please wait…" : currentlyIn ? "Clock out" : "Clock in"}
          </Button>
          <Link
            href="/kiosk"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3 text-base font-semibold"
          >
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
