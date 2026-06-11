import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { resolveNoticesStaff } from "@/lib/tenant/notices-access";
import { NOTICES_COOKIE } from "@/lib/kiosk-cookie";

/**
 * Private staff notices entry point. The owner shares /me/<token> with ONE
 * staff member. We validate the token, drop it into an httpOnly cookie scoped
 * to /me, and redirect to the clean /me URL so the secret doesn't linger in
 * history. An unknown/rotated token still redirects to /me, which then shows a
 * "link no longer valid" message. The link only identifies WHO — /me requires
 * their PIN before showing anything personal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const staff = await resolveNoticesStaff(token);

  const res = NextResponse.redirect(new URL("/me", env.APP_URL));
  if (staff) {
    res.cookies.set(NOTICES_COOKIE, token, {
      path: "/me",
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      // Long-lived: the phone stays linked until the owner rotates the link.
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
