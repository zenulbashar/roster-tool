import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, organisations } from "@/lib/db/schema";
import { env } from "@/lib/env";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_MS,
  makeImpersonationToken,
  parseImpersonationToken,
  type ImpersonationClaims,
} from "@/lib/admin/impersonation";
import { isPlatformAdmin } from "@/lib/admin/repository";

/**
 * Server-side plumbing for the "view as venue" impersonation cookie (M37): read
 * + fully re-validate it, and set/clear it from the enter/exit actions.
 */

export interface ActiveImpersonation {
  adminUserId: string;
  orgId: string;
  /** The entry location bound in the token (a default; the switcher can move). */
  businessId: string;
  /** The client (organisation) name — the stable banner label. */
  venueName: string;
}

/**
 * Resolve + fully re-validate the impersonation cookie for the current request,
 * or null when absent/invalid. Re-checked EVERY request (defence in depth):
 *  - HMAC signature + freshness (parseImpersonationToken),
 *  - the acting user is STILL a platform_admin (revoking admin ends it),
 *  - the bound location still belongs to the bound org.
 * Cheap for ordinary owners: an absent/garbage cookie returns before any query.
 */
export async function resolveImpersonation(): Promise<ActiveImpersonation | null> {
  const store = await cookies();
  const raw = store.get(IMPERSONATION_COOKIE)?.value;
  const claims = parseImpersonationToken(raw, env.AUTH_SECRET);
  if (!claims) return null;
  if (!(await isPlatformAdmin(claims.adminUserId))) return null;
  const [row] = await db
    .select({ orgId: businesses.orgId, orgName: organisations.name })
    .from(businesses)
    .innerJoin(organisations, eq(organisations.id, businesses.orgId))
    .where(eq(businesses.id, claims.businessId))
    .limit(1);
  if (!row || row.orgId !== claims.orgId) return null;
  return {
    adminUserId: claims.adminUserId,
    orgId: claims.orgId,
    businessId: claims.businessId,
    venueName: row.orgName,
  };
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

/** Clear the impersonation cookie (from the exit action). */
export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}
