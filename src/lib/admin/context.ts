import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformAdmins } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { parseAdminAllowlist, isEmailAllowed } from "@/lib/admin/allowlist";

/**
 * Server-side guards for the Zale IT admin console (M37).
 *
 * An admin is a platform (vendor) operator, NOT a tenant owner: they sign in
 * with the ordinary email magic link, but their access comes from a
 * `platform_admin` row rather than an `org_membership`. The admin area reads
 * across ALL tenants (the single, explicit exception to per-business scoping in
 * this codebase) and can enter a live tenant only through impersonation. These
 * guards derive identity from the session — never request input.
 */

export interface AdminIdentity {
  userId: string;
  /** Display name for the chrome ("Priya · Zale IT"); never null. */
  name: string;
  email: string | null;
}

type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

async function resolveAdminForUser(
  user: SessionUser,
): Promise<AdminIdentity | null> {
  const [existing] = await db
    .select({ name: platformAdmins.name })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, user.id))
    .limit(1);

  if (existing) {
    return {
      userId: user.id,
      name: existing.name ?? user.name ?? user.email ?? "Admin",
      email: user.email ?? null,
    };
  }

  // Bootstrap path: an allow-listed email becomes an admin on first sign-in.
  // FAIL CLOSED — an unset/empty ADMIN_ALLOWLIST provisions nobody.
  const allow = parseAdminAllowlist(env.ADMIN_ALLOWLIST);
  if (!isEmailAllowed(user.email, allow)) return null;

  await db
    .insert(platformAdmins)
    .values({ userId: user.id, name: user.name ?? null })
    .onConflictDoNothing({ target: platformAdmins.userId });

  return {
    userId: user.id,
    name: user.name ?? user.email ?? "Admin",
    email: user.email ?? null,
  };
}

/** The signed-in user as a platform admin, or null (not signed in / not admin). */
export async function resolveAdmin(): Promise<AdminIdentity | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return resolveAdminForUser(session.user);
}

/**
 * Require a platform admin. Signed-out → sign-in; signed-in but not an admin →
 * 404 (the admin area simply does not exist for them — no hint it's there).
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const admin = await resolveAdminForUser(session.user);
  if (!admin) notFound();
  return admin;
}
