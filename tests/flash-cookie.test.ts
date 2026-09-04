import { describe, it, expect } from "vitest";
import {
  FLASH_COOKIES,
  flashCookieOptions,
  isFlashCookieName,
  type FlashCookieName,
} from "@/lib/flash-cookie";

/**
 * SEC-18 regression guard: the "show once" cookies carry raw capability
 * tokens (kiosk, personal clock-in, staff notices, Xero invite) that are
 * permanent until rotated. They must NEVER be readable by page scripts.
 */
describe("flash cookies (SEC-18)", () => {
  it("registers exactly the four show-once link cookies", () => {
    expect(Object.keys(FLASH_COOKIES).sort()).toEqual(
      [
        "kiosk_link_once",
        "notices_link_once",
        "personal_clock_link_once",
        "xero_invite_once",
      ].sort(),
    );
  });

  it("every registered flash cookie is httpOnly, short-lived and path-scoped", () => {
    for (const name of Object.keys(FLASH_COOKIES) as FlashCookieName[]) {
      const opts = flashCookieOptions(name);
      expect(opts.httpOnly).toBe(true);
      expect(opts.maxAge).toBeLessThanOrEqual(300);
      expect(opts.path.startsWith("/app/")).toBe(true);
      expect(opts.sameSite).toBe("lax");
    }
  });

  it("refuses to build options for an unregistered name", () => {
    expect(() =>
      flashCookieOptions("authjs.session-token" as FlashCookieName),
    ).toThrow(/Unregistered/);
  });

  it("only recognises registered names (the clear action's allow-list)", () => {
    expect(isFlashCookieName("kiosk_link_once")).toBe(true);
    expect(isFlashCookieName("authjs.session-token")).toBe(false);
    expect(isFlashCookieName("roster_impersonation")).toBe(false);
    expect(isFlashCookieName("__proto__")).toBe(false);
  });
});
