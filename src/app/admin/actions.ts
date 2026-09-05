"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/context";
import { createAdminRepo } from "@/lib/admin/repository";
import {
  resolveImpersonation,
  setImpersonationCookie,
  clearImpersonationCookie,
} from "@/lib/admin/impersonation-session";
import {
  isFlagKey,
  setGlobalFlag,
  setOrgFlagOverride,
  clearOrgFlagOverride,
  type FlagKey,
} from "@/lib/flags";

/**
 * Server actions for the Zale IT admin console (M37): begin / end impersonation,
 * log an impersonated write, and set a client's plan status. Every action
 * re-derives the admin identity + tenant server-side — never from client input.
 */

const orgIdSchema = z.string().uuid();

/**
 * Begin "view as venue": bind a signed impersonation cookie to (admin, org,
 * entry location) and drop the admin into the owner app. The active-location
 * switcher then lets them move between the client's locations.
 */
export async function enterImpersonation(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orgId = orgIdSchema.parse(formData.get("orgId"));
  const repo = createAdminRepo();
  const loc = await repo.firstLocationOfOrg(orgId);
  if (!loc) redirect("/admin/clients");
  const client = await repo.getClient(orgId);

  await setImpersonationCookie({
    adminUserId: admin.userId,
    orgId,
    businessId: loc.id,
  });
  await repo.recordActivity({
    adminUserId: admin.userId,
    adminName: admin.name,
    action: "Entered live account",
    isWrite: false,
    orgId,
    businessId: loc.id,
    venueName: client?.name ?? loc.name,
  });
  redirect("/app");
}

/** End impersonation and return to the console. */
export async function exitImpersonation(): Promise<void> {
  const admin = await requireAdmin();
  const imp = await resolveImpersonation();
  if (imp) {
    await createAdminRepo().recordActivity({
      adminUserId: admin.userId,
      adminName: admin.name,
      action: "Exited live account",
      isWrite: false,
      orgId: imp.orgId,
      businessId: imp.businessId,
      venueName: imp.venueName,
    });
  }
  await clearImpersonationCookie();
  redirect("/admin/clients");
}

/**
 * Set a client's vendor account-lifecycle label (active / trial / paused).
 * Routed through the admin repo — the ONE cross-tenant data-access layer —
 * and recorded as a write (SEC-02 item 4).
 */
export async function setPlanStatus(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orgId = orgIdSchema.parse(formData.get("orgId"));
  const status = z
    .enum(["active", "trial", "paused"])
    .parse(formData.get("status"));
  await createAdminRepo().setPlanStatus(orgId, status);
  await createAdminRepo().recordActivity({
    adminUserId: admin.userId,
    adminName: admin.name,
    action: "Set plan status",
    detail: status,
    // A vendor-side write to `organisation` — flagged as such in the log.
    isWrite: true,
    orgId,
  });
  revalidatePath(`/admin/clients/${orgId}`);
  revalidatePath("/admin/clients");
}

/* ----- Feature flags (OPS-05) ----- */

const flagKeySchema = z
  .string()
  .refine((k): k is FlagKey => isFlagKey(k), "Unknown feature flag");

/**
 * Set a flag for EVERYONE: on, off, or back to the code default. A vendor-side
 * write, recorded in the admin activity log like a plan-status change.
 */
export async function setFeatureFlagGlobal(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const key = flagKeySchema.parse(formData.get("key"));
  const value = z.enum(["on", "off", "default"]).parse(formData.get("value"));
  await setGlobalFlag(
    key,
    value === "default" ? null : value === "on",
    admin.name,
  );
  await createAdminRepo().recordActivity({
    adminUserId: admin.userId,
    adminName: admin.name,
    action: "Set feature flag",
    detail: `${key} → ${value} for everyone`,
    isWrite: true,
  });
  revalidatePath("/admin/flags");
}

/**
 * Set (or clear) a flag for ONE client organisation — the dark-launch / kill
 * switch for a single client. The override wins over the global value.
 */
export async function setFeatureFlagOverride(
  formData: FormData,
): Promise<void> {
  const admin = await requireAdmin();
  const key = flagKeySchema.parse(formData.get("key"));
  const orgId = orgIdSchema.parse(formData.get("orgId"));
  const value = z.enum(["on", "off", "clear"]).parse(formData.get("value"));

  let venueName: string | null;
  if (value === "clear") {
    venueName = (await clearOrgFlagOverride(key, orgId)).orgName;
  } else {
    const res = await setOrgFlagOverride(
      key,
      orgId,
      value === "on",
      admin.name,
    );
    if (!res.ok) redirect("/admin/flags?error=unknown_org");
    venueName = res.orgName;
  }
  await createAdminRepo().recordActivity({
    adminUserId: admin.userId,
    adminName: admin.name,
    action: "Set feature flag for a client",
    detail: `${key} → ${value}`,
    isWrite: true,
    orgId,
    venueName,
  });
  revalidatePath("/admin/flags");
}
