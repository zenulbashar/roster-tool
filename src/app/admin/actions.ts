"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { organisations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/admin/context";
import { createAdminRepo, getAdminDisplayName } from "@/lib/admin/repository";
import {
  resolveImpersonation,
  setImpersonationCookie,
  clearImpersonationCookie,
} from "@/lib/admin/impersonation-session";

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
 * Best-effort audit of a write made while impersonating. Called by the
 * write-confirm guard just before it lets the intercepted form submit. Derives
 * everything from the impersonation cookie (never client input beyond the
 * action's own title/context text) and never redirects — a logging failure must
 * not block or divert the owner-app write it precedes.
 */
export async function logImpersonatedWrite(input: {
  action: string;
  detail?: string;
}): Promise<void> {
  const imp = await resolveImpersonation();
  if (!imp) return;
  const adminName = await getAdminDisplayName(imp.adminUserId);
  await createAdminRepo().recordActivity({
    adminUserId: imp.adminUserId,
    adminName,
    action: input.action?.trim() || "Saved a change",
    detail: input.detail?.trim() || null,
    isWrite: true,
    orgId: imp.orgId,
    businessId: imp.businessId,
    venueName: imp.venueName,
  });
}

/** Set a client's vendor account-lifecycle label (active / trial / paused). */
export async function setPlanStatus(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const orgId = orgIdSchema.parse(formData.get("orgId"));
  const status = z
    .enum(["active", "trial", "paused"])
    .parse(formData.get("status"));
  await db
    .update(organisations)
    .set({ planStatus: status })
    .where(eq(organisations.id, orgId));
  await createAdminRepo().recordActivity({
    adminUserId: admin.userId,
    adminName: admin.name,
    action: "Set plan status",
    detail: status,
    isWrite: false,
    orgId,
  });
  revalidatePath(`/admin/clients/${orgId}`);
  revalidatePath("/admin/clients");
}
