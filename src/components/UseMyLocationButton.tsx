"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/**
 * Fills the latitude/longitude inputs from the browser's geolocation while the
 * owner is standing in the shop. One-shot read on click — no tracking. The
 * owner reviews the values and Saves.
 */
export function UseMyLocationButton({
  latId,
  lngId,
}: {
  latId: string;
  lngId: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = () => {
    setStatus(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("Location isn't available on this device. Type it in instead.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = document.getElementById(latId) as HTMLInputElement | null;
        const lng = document.getElementById(lngId) as HTMLInputElement | null;
        if (lat) lat.value = pos.coords.latitude.toFixed(6);
        if (lng) lng.value = pos.coords.longitude.toFixed(6);
        setBusy(false);
        setStatus("Filled in your current location. Check it, then Save.");
      },
      () => {
        setBusy(false);
        setStatus(
          "We couldn't get your location. Allow location access and try again, or type it in.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  return (
    <div>
      <Button type="button" variant="secondary" disabled={busy} onClick={fill}>
        {busy ? "Locating…" : "Use my current location"}
      </Button>
      {status ? (
        <p className="mt-2 text-sm text-[var(--color-muted)]">{status}</p>
      ) : null}
    </div>
  );
}
