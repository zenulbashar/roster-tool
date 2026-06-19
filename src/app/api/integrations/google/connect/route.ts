import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/context";
import { env } from "@/lib/env";
import {
  googleDriveClient,
  isDriveConfigured,
} from "@/lib/google-drive/client";
import { OAUTH_COOKIE_PATH, OAUTH_STATE_COOKIE } from "../oauth-state";

/**
 * Start the Google Drive OAuth connect. OWNER session required (this is an
 * additional authorization, never a login). We mint a CSRF `state` nonce,
 * stash it in a short-lived httpOnly cookie, and redirect to Google's consent
 * screen for the drive.file scope. The businessId is taken from the session on
 * callback, never from `state`.
 */
export async function GET() {
  await requireOwner();
  const settings = `${env.APP_URL}/app/settings`;

  if (!isDriveConfigured()) {
    return NextResponse.redirect(
      `${settings}?driveError=${encodeURIComponent(
        "Google Drive isn’t set up yet. Please contact your administrator.",
      )}`,
    );
  }

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(googleDriveClient.buildAuthUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    path: OAUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 600,
  });
  return res;
}
