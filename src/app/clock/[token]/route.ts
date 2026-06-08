import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { resolvePersonalClockBusiness } from "@/lib/tenant/personal-clock-access";
import { PERSONAL_CLOCK_COOKIE } from "@/lib/kiosk-cookie";

/**
 * Personal-phone clock-in entry point. The owner shares /clock/<token> with
 * staff for their own phones. We validate the token, drop it into an httpOnly
 * cookie scoped to /clock, and redirect to the clean /clock URL so the secret
 * doesn't linger in history. An unknown/rotated token still redirects to /clock,
 * which then shows a "link no longer valid" message. This route only authorises
 * the GPS-checked flow — it is NOT the shared kiosk.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const business = await resolvePersonalClockBusiness(token);

  const res = NextResponse.redirect(new URL("/clock", env.APP_URL));
  if (business) {
    res.cookies.set(PERSONAL_CLOCK_COOKIE, token, {
      path: "/clock",
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      // Long-lived: the phone stays signed in until the link is rotated.
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
