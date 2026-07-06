import { NextResponse, type NextRequest } from "next/server";
import { ownerRepo } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { safeHashEqual } from "@/lib/tokens";
import { googleDriveClient } from "@/lib/google-drive/client";
import { completeConnection } from "@/lib/google-drive/service";
import { OAUTH_COOKIE_PATH, OAUTH_STATE_COOKIE } from "../oauth-state";

/**
 * Google OAuth callback. OWNER session required — the businessId comes from the
 * session (never from the URL). We verify the CSRF `state` against the cookie,
 * exchange the code for tokens, store them ENCRYPTED, record the account email
 * and create the root folder (in `completeConnection`). Any failure redirects
 * to Settings with a friendly message — it never crashes.
 */
export async function GET(req: NextRequest) {
  const repo = await ownerRepo();
  const settings = `${env.APP_URL}/app/settings`;

  const fail = (message: string) => {
    const res = NextResponse.redirect(
      `${settings}?driveError=${encodeURIComponent(message)}`,
    );
    res.cookies.set(OAUTH_STATE_COOKIE, "", {
      path: OAUTH_COOKIE_PATH,
      maxAge: 0,
    });
    return res;
  };

  const params = req.nextUrl.searchParams;

  // The owner clicked "Cancel" on Google's consent screen, or Google errored.
  if (params.get("error")) {
    return fail("Google Drive wasn’t connected.");
  }

  const code = params.get("code");
  const state = params.get("state");
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;
  if (!code || !state || !expected || !safeHashEqual(state, expected)) {
    return fail("Couldn’t verify the Google sign-in. Please try again.");
  }

  try {
    await completeConnection({ repo, client: googleDriveClient, code });
  } catch (err) {
    logger.error({ err }, "Google Drive connect failed");
    return fail("Couldn’t connect Google Drive. Please try again.");
  }

  const res = NextResponse.redirect(`${settings}?driveConnected=1`);
  res.cookies.set(OAUTH_STATE_COOKIE, "", {
    path: OAUTH_COOKIE_PATH,
    maxAge: 0,
  });
  return res;
}
