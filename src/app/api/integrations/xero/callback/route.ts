import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ownerRepo } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { consumeXeroConnectInvite } from "@/lib/tenant/repository";
import { logger } from "@/lib/logger";
import { safeHashEqual } from "@/lib/tokens";
import { xeroClient } from "@/lib/xero/client";
import { completeXeroConnection } from "@/lib/xero/service";
import {
  XERO_INVITE_TOKEN_COOKIE,
  XERO_OAUTH_COOKIE_PATH,
  XERO_OAUTH_STATE_COOKIE,
} from "../oauth-state";

/**
 * Xero OAuth callback. Two modes, distinguished by the delegated-invite cookie:
 *
 *  - OWNER mode (no invite cookie): `businessId` from the OWNER SESSION
 *    (`ownerRepo`), redirect back to Settings.
 *  - DELEGATED mode (invite cookie present): the bookkeeper has NO owner
 *    session; the invite's raw token is consumed ATOMICALLY here (single-use,
 *    revoke/expiry-safe) to resolve `businessId`, and we land on a public
 *    "connected" page telling them the owner will confirm.
 *
 * Either way the connection is stored `pending_confirmation` — a push is refused
 * until the owner confirms the org name. All failures redirect friendly.
 */
export async function GET(req: NextRequest) {
  const inviteToken = req.cookies.get(XERO_INVITE_TOKEN_COOKIE)?.value ?? null;
  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const expected = req.cookies.get(XERO_OAUTH_STATE_COOKIE)?.value ?? null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = req.headers.get("user-agent");

  const clearCookies = (res: NextResponse) => {
    res.cookies.set(XERO_OAUTH_STATE_COOKIE, "", {
      path: XERO_OAUTH_COOKIE_PATH,
      maxAge: 0,
    });
    res.cookies.set(XERO_INVITE_TOKEN_COOKIE, "", {
      path: XERO_OAUTH_COOKIE_PATH,
      maxAge: 0,
    });
    return res;
  };

  const stateOk = code && state && expected && safeHashEqual(state, expected);

  // --- Delegated bookkeeper mode ----------------------------------------
  if (inviteToken) {
    const landing = `${env.APP_URL}/xero/connected`;
    const failDelegated = () =>
      clearCookies(NextResponse.redirect(`${landing}?error=1`));
    if (params.get("error") || !stateOk) return failDelegated();
    // Consume the single-use invite ATOMICALLY (resolves businessId).
    const invite = await consumeXeroConnectInvite(inviteToken, {
      consumedIp: ip,
      consumedUserAgent: userAgent,
    });
    if (!invite) return failDelegated();
    try {
      const repo = createTenantRepo(invite.businessId);
      await completeXeroConnection({
        repo,
        client: xeroClient,
        code: code!,
        connectedViaInviteId: invite.id,
        connectedIp: ip,
        connectedUserAgent: userAgent,
      });
    } catch (err) {
      logger.error({ err }, "Xero delegated connect failed");
      return failDelegated();
    }
    return clearCookies(NextResponse.redirect(`${landing}?connected=1`));
  }

  // --- Owner mode --------------------------------------------------------
  const repo = await ownerRepo();
  const settings = `${env.APP_URL}/app/settings`;
  const fail = (message: string) =>
    clearCookies(
      NextResponse.redirect(
        `${settings}?xeroError=${encodeURIComponent(message)}`,
      ),
    );
  if (params.get("error")) return fail("Xero wasn’t connected.");
  if (!stateOk) {
    return fail("Couldn’t verify the Xero sign-in. Please try again.");
  }
  try {
    await completeXeroConnection({
      repo,
      client: xeroClient,
      code: code!,
      connectedIp: ip,
      connectedUserAgent: userAgent,
    });
  } catch (err) {
    logger.error({ err }, "Xero connect failed");
    return fail("Couldn’t connect Xero. Please try again.");
  }
  return clearCookies(NextResponse.redirect(`${settings}?xeroConnected=1`));
}
