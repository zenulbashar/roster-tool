"use client";

import { useEffect } from "react";

/**
 * Clears a (non-httpOnly) flash cookie from the browser right after it has been
 * rendered once. Used so the freshly-generated kiosk link is shown a single
 * time and doesn't linger in the cookie store.
 */
export function ClearFlashCookie({ name }: { name: string }) {
  useEffect(() => {
    document.cookie = `${name}=; Max-Age=0; path=/app/settings`;
  }, [name]);
  return null;
}
