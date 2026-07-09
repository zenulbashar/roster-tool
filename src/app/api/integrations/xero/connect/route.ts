import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireOwner } from "@/lib/auth/context";
import { isXeroConfigured, xeroClient } from "@/lib/xero/client";
import {
  XERO_OAUTH_COOKIE_PATH,
  XERO_OAUTH_STATE_COOKIE,
} from "../oauth-state";

/**
 * Start the Xero OAuth connect. Owner-session-gated (businessId is derived from
 * the session in the callback, never from the URL). Mirrors the Google Drive
 * connect: a short-lived httpOnly CSRF `state` cookie, then a redirect to Xero's
 * consent screen. Fails closed with a friendly message when unconfigured.
 */
export async function GET() {
  await requireOwner();
  const settings = `${env.APP_URL}/app/settings`;
  if (!isXeroConfigured()) {
    return NextResponse.redirect(
      `${settings}?xeroError=${encodeURIComponent(
        "Xero isn’t set up on this server yet.",
      )}`,
    );
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(xeroClient.buildAuthUrl(state));
  res.cookies.set(XERO_OAUTH_STATE_COOKIE, state, {
    path: XERO_OAUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 600,
  });
  return res;
}
