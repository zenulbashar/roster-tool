import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { createOrgRepo, type OrgRepo } from "@/lib/tenant/org-repository";
import {
  resolveOrgForUser,
  resolveActiveLocation,
} from "@/lib/tenant/org-access";
import { resolveImpersonation } from "@/lib/admin/impersonation-session";
import {
  createAdminRepo,
  getAdminDisplayName,
  isPlatformAdmin,
} from "@/lib/admin/repository";
import {
  withAudit,
  type AuditContext,
  type AuditSink,
} from "@/lib/audit/decorate";
import { humanizeAction, type NewAuditEvent } from "@/lib/audit/events";
import { isFeatureEnabled } from "@/lib/flags";
import { getRequestId } from "@/lib/request-context";

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
export interface OwnerContext {
  userId: string;
  orgId: string;
  businessId: string;
  email: string | null;
  /**
   * Set when a Zale IT admin is acting inside this tenant via "view as venue"
   * (M37). The owner layout uses it to render the persistent red banner + inset
   * frame + write-confirm guard. Null for a real owner session.
   */
  impersonation: { adminUserId: string; venueName: string } | null;
  /**
   * Who this request's writes are attributed to in the tenant audit trail
   * (OPS-04), plus the request id and the `audit_events` flag — consumed by
   * `ownerRepo()` / `ownerContext()`, which wrap every repo they hand out.
   */
  audit: AuditContext;
}

/**
 * MEMOISED PER REQUEST (PERF-04): `React.cache` dedupes the session lookup,
 * the impersonation check, the org resolution and the active-location query
 * across everything rendered for one request — the owner layout (bell +
 * location switcher), the page, and any server action in that request — so
 * calling `requireOwner()` / `ownerRepo()` / `orgRepo()` / `ownerContext()`
 * freely costs one resolution, not one per call site. The cache is scoped to
 * the request by React, never shared across requests or users; a `redirect()`
 * thrown here is cached for the request too, so every caller sees the same
 * outcome. Outside a React request scope (scripts, tests) it simply runs.
 */
export const requireOwner = cache(resolveOwner);

async function resolveOwner(): Promise<OwnerContext> {
  // Resolve the session FIRST — it is the identity every branch below is
  // bound to. M37: an admin impersonating a tenant resolves the org from the
  // signed impersonation grant (re-validated in resolveImpersonation, which
  // requires the grant to be bound to THIS session's user — the cookie alone
  // is never sufficient), NOT from an org_membership — an admin has none. The
  // active-location cookie still applies, so the location switcher works while
  // impersonating.
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  const userId = session.user.id;

  const imp = await resolveImpersonation(userId);
  if (imp) {
    const businessId = await resolveActiveLocation(imp.orgId, imp.businessId);
    if (!businessId) redirect("/admin/clients");
    const [auditEnabled, requestId, adminName] = await Promise.all([
      isFeatureEnabled("audit_events", { orgId: imp.orgId }),
      getRequestId(),
      getAdminDisplayName(imp.adminUserId),
    ]);
    return {
      userId: imp.adminUserId,
      orgId: imp.orgId,
      businessId,
      email: null,
      impersonation: {
        adminUserId: imp.adminUserId,
        venueName: imp.venueName,
      },
      audit: {
        enabled: auditEnabled,
        requestId,
        actor: {
          type: "admin",
          userId: imp.adminUserId,
          label: adminName,
          impersonatorUserId: imp.adminUserId,
        },
      },
    };
  }

  const orgId = await resolveOrgForUser(userId);
  if (!orgId) {
    // A platform admin who isn't impersonating has no org — send them to the
    // console rather than the owner onboarding flow.
    if (await isPlatformAdmin(userId)) redirect("/admin/clients");
    redirect("/onboarding");
  }
  const businessId = await resolveActiveLocation(
    orgId,
    session.user.businessId ?? null,
  );
  if (!businessId) redirect("/onboarding");
  const [auditEnabled, requestId] = await Promise.all([
    isFeatureEnabled("audit_events", { orgId }),
    getRequestId(),
  ]);
  const email = session.user.email ?? null;
  return {
    userId,
    orgId,
    businessId,
    email,
    impersonation: null,
    audit: {
      enabled: auditEnabled,
      requestId,
      actor: {
        type: "owner",
        userId,
        label: email ?? userId,
        impersonatorUserId: null,
      },
    },
  };
}

/* ----- Audited repos (OPS-04 / SEC-02) ----- */

/**
 * Mirror a write made while impersonating into the admin console's
 * accountability log — SERVER-derived from the actual repository call, which
 * supersedes the old client-reported entries (SEC-02/SEC-03). Best-effort;
 * the decorator reports a failure rather than failing the write.
 */
function impersonatedWriteMirror(ctx: OwnerContext) {
  return async (event: NewAuditEvent): Promise<void> => {
    if (!ctx.impersonation) return;
    await createAdminRepo().recordActivity({
      adminUserId: ctx.impersonation.adminUserId,
      adminName: ctx.audit.actor.label,
      action: humanizeAction(event.action),
      detail: event.entity
        ? `${event.entity.replaceAll("_", " ")}${event.entityId ? ` ${event.entityId}` : ""}`
        : null,
      isWrite: true,
      orgId: ctx.orgId,
      businessId: ctx.businessId,
      venueName: ctx.impersonation.venueName,
    });
  };
}

/** The active-location tenant repo, every write recorded in the trail. */
function auditedTenantRepo(ctx: OwnerContext): TenantRepo {
  const raw = createTenantRepo(ctx.businessId);
  const sink: AuditSink = {
    append: (event) => raw.appendAuditEvent({ ...event, orgId: ctx.orgId }),
    onImpersonatedWrite: impersonatedWriteMirror(ctx),
  };
  return withAudit(raw, sink, ctx.audit);
}

/** The org repo, its (org-level) writes recorded in the org's chain. */
function auditedOrgRepo(ctx: OwnerContext): OrgRepo {
  const raw = createOrgRepo(ctx.orgId);
  const sink: AuditSink = {
    append: (event) => raw.appendAuditEvent(event),
    onImpersonatedWrite: impersonatedWriteMirror(ctx),
  };
  return withAudit(raw, sink, ctx.audit);
}

/** A tenant repo scoped to the current owner's ACTIVE location. */
export async function ownerRepo() {
  return auditedTenantRepo(await requireOwner());
}

/** A repo scoped to the current owner's organisation (locations, people). */
export async function orgRepo() {
  return auditedOrgRepo(await requireOwner());
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
    repo: auditedTenantRepo(ctx),
    org: auditedOrgRepo(ctx),
  };
}
