import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createTenantRepo } from "@/lib/tenant/repository";

/**
 * Server-side guards for the owner area. These derive the tenant from the
 * authenticated session — never from request input — and are the single source
 * of `businessId` for owner pages and actions.
 */

/**
 * If an owner already has a valid session, send them to the dashboard.
 *
 * Used on the sign-in page — on both the GET render AND inside the form's
 * server action — so an already-authenticated owner is never shown the email
 * form or has a magic link sent. The action check matters because a logged-out
 * render of the form can be replayed to a now-authenticated owner (Next's
 * client router cache / bfcache / a stale tab) without a fresh server render,
 * and server actions always run server-side — mirroring how other actions in
 * this app (e.g. onboarding) re-validate the session rather than trusting the
 * page that rendered the form.
 */
export async function redirectIfAuthenticated() {
  const session = await auth();
  if (session?.user) redirect("/app");
}

/** Require a signed-in user. Redirects to sign-in otherwise. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  return session;
}

/**
 * Require a signed-in owner who has completed onboarding (has a business).
 * Redirects to sign-in or onboarding as needed.
 */
export async function requireOwner() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  if (!session.user.businessId) redirect("/onboarding");
  return {
    userId: session.user.id,
    businessId: session.user.businessId,
    email: session.user.email ?? null,
  };
}

/** A tenant repo scoped to the current owner's business. */
export async function ownerRepo() {
  const { businessId } = await requireOwner();
  return createTenantRepo(businessId);
}
