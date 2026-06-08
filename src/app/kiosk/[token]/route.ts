import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { resolveKioskBusiness } from "@/lib/tenant/kiosk-access";
import { KIOSK_COOKIE } from "@/lib/kiosk-cookie";

/**
 * Kiosk entry point. The owner shares /kiosk/<token> for a shared device. We
 * validate the token, drop it into an httpOnly cookie scoped to /kiosk, and
 * redirect to the clean /kiosk URL so the secret doesn't linger in the address
 * bar or history on a shared screen. An unknown/rotated token still redirects
 * to /kiosk, which then shows a "link no longer valid" message.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const business = await resolveKioskBusiness(token);

  const res = NextResponse.redirect(new URL("/kiosk", env.APP_URL));
  if (business) {
    res.cookies.set(KIOSK_COOKIE, token, {
      path: "/kiosk",
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      // Long-lived: the kiosk device stays signed in until the link is rotated.
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
