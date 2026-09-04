"use client";

import { useEffect } from "react";
import { clearFlashCookie } from "@/app/actions/flash";

/**
 * Clears a "show once" flash cookie right after the server has rendered the
 * link it carried, so a freshly-generated capability link (kiosk, personal
 * clock-in, staff notices, Xero invite) is shown a single time and doesn't
 * linger in the cookie store.
 *
 * The cookies are httpOnly (SEC-18), so this component never sees their value
 * — it only asks the server to delete them, and the server only honours
 * registered flash-cookie names (see `src/lib/flash-cookie.ts`).
 */
export function ClearFlashCookie({ name }: { name: string }) {
  useEffect(() => {
    void clearFlashCookie(name);
  }, [name]);
  return null;
}
