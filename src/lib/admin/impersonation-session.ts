import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { businesses, organisations } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_MS,
  makeImpersonationToken,
  type ImpersonationClaims,
} from "@/lib/admin/impersonation";
import { isPlatformAdmin } from "@/lib/admin/repository";
import {
  resolveImpersonationFor,
  type ActiveImpersonation,
  type ImpersonationDeps,
} from "@/lib/admin/impersonation-resolve";

export type { ActiveImpersonation } from "@/lib/admin/impersonation-resolve";

/**
 * Next-bound plumbing for the "view as venue" impersonation cookie (M37): read
 * it for the current request, resolve it through the pure, session-bound logic
 * in `impersonation-resolve.ts`, and set/clear it from the enter/exit actions.
 */

const deps: ImpersonationDeps = {
  isPlatformAdmin,
  async findLocationOrg(businessId) {
    const [row] = await db
      .select({ orgId: businesses.orgId, orgName: organisations.name })
      .from(businesses)
      .innerJoin(organisations, eq(organisations.id, businesses.orgId))
      .where(eq(businesses.id, businessId))
      .limit(1);
    return row ?? null;
  },
};

/**
 * Resolve the impersonation grant for the CURRENT request. Cheap for ordinary
 * owners: an absent cookie returns before the session or any query is touched.
 * Pass `sessionUserId` when the caller has already resolved the session (avoids
 * a second `auth()` round trip); otherwise it is resolved here. Either way the
 * grant only resolves for the admin it is bound to — never as a bearer token.
 */
export async function resolveImpersonation(
  sessionUserId?: string | null,
): Promise<ActiveImpersonation | null> {
  const store = await cookies();
  const raw = store.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;
  const userId =
    sessionUserId === undefined
      ? ((await auth())?.user?.id ?? null)
      : sessionUserId;
  return resolveImpersonationFor(
    { cookieValue: raw, sessionUserId: userId },
    deps,
  );
}

/** Set the signed impersonation cookie (from the enter action). */
export async function setImpersonationCookie(
  claims: ImpersonationClaims,
): Promise<void> {
  const store = await cookies();
  store.set(
    IMPERSONATION_COOKIE,
    makeImpersonationToken(claims, env.AUTH_SECRET),
    {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: Math.floor(IMPERSONATION_TTL_MS / 1000),
    },
  );
}

/**
 * Clear the impersonation cookie. Called from the exit action AND from every
 * sign-out / sign-in path, so a grant can never outlive the session it was
 * bound to on the same browser.
 */
export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}
