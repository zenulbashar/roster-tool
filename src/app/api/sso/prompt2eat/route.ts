import { NextResponse } from "next/server";
import { verifyRosterHandoffToken } from "@/lib/sso/roster-sso";
import { consumeJti } from "@/lib/sso/replay";
import {
  matchOrProvisionUser,
  createDbSession,
  sessionCookieConfig,
} from "@/lib/auth/sso-session";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Inbound SSO from prompt2eat: `POST /api/sso/prompt2eat`.
 *
 * prompt2eat's browser submits a cross-origin POST with a single `token` form
 * field (the JWS in the BODY, never a URL, so it never lands in a log, referrer
 * or history). We verify the token, enforce single use, match-or-provision the
 * owner by verified email in Roster's OWN store, mint Roster's OWN session, and
 * 303-redirect to a FIXED path. There is no redirect parameter, so there is no
 * open-redirect surface. Any failure lands on a generic sign-in error that
 * never echoes token contents. See docs/roster-sso-contract.md.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fixed landing path on success — no redirect param, no open-redirect. */
const SUCCESS_PATH = "/app";
/** Generic failure page; the sign-in page renders a friendly message for `sso`. */
const FAILURE_PATH = "/sign-in?error=sso";

function redirectTo(path: string): NextResponse {
  // 303 forces the follow-up to be a GET (a top-level, same-site navigation),
  // so the freshly-set Lax session cookie is sent on the redirected request.
  return NextResponse.redirect(new URL(path, env.APP_URL), 303);
}

function fail(reason: string): NextResponse {
  logger.warn({ reason }, "prompt2eat SSO rejected");
  return redirectTo(FAILURE_PATH);
}

export async function POST(request: Request): Promise<NextResponse> {
  let token: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("token");
    token = typeof value === "string" ? value : null;
  } catch {
    return fail("no_body");
  }
  if (!token) return fail("no_token");

  const result = verifyRosterHandoffToken(token);
  if (!result.ok) return fail(result.reason);
  const { claims } = result;

  // Single-use: a replayed jti (or any guard error) is rejected.
  const firstUse = await consumeJti(claims.jti);
  if (!firstUse) return fail("replay");

  try {
    const user = await matchOrProvisionUser(claims.email, claims.name);
    const { sessionToken, expires } = await createDbSession(user.id);

    const { name, secure } = sessionCookieConfig();
    const response = redirectTo(SUCCESS_PATH);
    response.cookies.set(name, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      expires,
    });
    return response;
  } catch (err) {
    logger.error({ err }, "prompt2eat SSO sign-in failed");
    return fail("internal");
  }
}
