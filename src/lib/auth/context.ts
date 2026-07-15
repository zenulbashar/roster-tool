import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createTenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import {
  resolveOrgForUser,
  resolveActiveLocation,
} from "@/lib/tenant/org-access";

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
 * Require a signed-in owner who has completed onboarding, and resolve their
 * organisation + ACTIVE location (M29). Redirects to sign-in or onboarding as
 * needed.
 *
 * - `orgId` comes from the owner's membership (never client input).
 * - `businessId` is the currently-selected location, resolved and VALIDATED
 *   against the org by `resolveActiveLocation` — a forged cookie can never
 *   select another org's business. Every existing owner page uses this as its
 *   tenant, so switching location re-scopes them all with no page changes.
 */
export async function requireOwner() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  const userId = session.user.id;
  const orgId = await resolveOrgForUser(userId);
  if (!orgId) redirect("/onboarding");
  const businessId = await resolveActiveLocation(
    orgId,
    session.user.businessId ?? null,
  );
  if (!businessId) redirect("/onboarding");
  return {
    userId,
    orgId,
    businessId,
    email: session.user.email ?? null,
  };
}

/** A tenant repo scoped to the current owner's ACTIVE location. */
export async function ownerRepo() {
  const { businessId } = await requireOwner();
  return createTenantRepo(businessId);
}

/** A repo scoped to the current owner's organisation (locations, people). */
export async function orgRepo() {
  const { orgId } = await requireOwner();
  return createOrgRepo(orgId);
}

/**
 * The full owner context in one call: ids plus both the active-location tenant
 * repo and the org repo. Pages that need both (e.g. the layout's location
 * switcher) use this to avoid re-resolving the session.
 */
export async function ownerContext() {
  const ctx = await requireOwner();
  return {
    ...ctx,
    repo: createTenantRepo(ctx.businessId),
    org: createOrgRepo(ctx.orgId),
  };
}
