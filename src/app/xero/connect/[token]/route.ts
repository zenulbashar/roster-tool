import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isXeroConfigured, xeroClient } from "@/lib/xero/client";
import {
  XERO_INVITE_TOKEN_COOKIE,
  XERO_OAUTH_COOKIE_PATH,
  XERO_OAUTH_STATE_COOKIE,
} from "@/app/api/integrations/xero/oauth-state";

/**
 * Delegated bookkeeper entry point (NO owner session). The owner emails this
 * link; the bookkeeper opens it and is sent straight to Xero's consent. We do
 * NOT consume the single-use invite here (a mail client could prefetch the GET)
 * — the raw token rides forward in an httpOnly cookie and is consumed ATOMICALLY
 * in the OAuth callback, after the human completes consent.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const landing = `${env.APP_URL}/xero/connected`;
  if (!isXeroConfigured() || !token) {
    return NextResponse.redirect(`${landing}?error=1`);
  }
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(xeroClient.buildAuthUrl(state));
  const cookieOpts = {
    path: XERO_OAUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    maxAge: 600,
  };
  res.cookies.set(XERO_OAUTH_STATE_COOKIE, state, cookieOpts);
  res.cookies.set(XERO_INVITE_TOKEN_COOKIE, token, cookieOpts);
  return res;
}
