"use client";

import { useEffect } from "react";

/**
 * Clears a (non-httpOnly) flash cookie from the browser right after it has been
 * rendered once. Used so a freshly-generated capability link (kiosk, personal
 * clock-in, staff notices) is shown a single time and doesn't linger in the
 * cookie store.
 */
export function ClearFlashCookie({
  name,
  path = "/app/settings",
}: {
  name: string;
  path?: string;
}) {
  useEffect(() => {
    document.cookie = `${name}=; Max-Age=0; path=${path}`;
  }, [name, path]);
  return null;
}
