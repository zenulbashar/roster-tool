"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/context";
import { createOrgRepo } from "@/lib/tenant/org-repository";
import { setActiveLocationCookie } from "@/lib/tenant/org-access";
import { AU_TIMEZONES } from "@/lib/timezones";

const locationSchema = z.object({
  name: z.string().trim().min(1, "Please enter a location name").max(120),
  timezone: z.enum(AU_TIMEZONES),
});

/**
 * Switch the owner's active location. N2: the target must belong to the owner's
 * org (validated server-side) before the cookie is written — a forged id is a
 * silent no-op. Redirects to the dashboard so no stale per-location page (e.g. a
 * roster id from the other location) 404s.
 */
export async function switchLocationAction(formData: FormData) {
  const businessId = formData.get("businessId");
  if (typeof businessId === "string" && businessId) {
    const { orgId } = await requireOwner();
    const org = createOrgRepo(orgId);
    if (await org.locationBelongsToOrg(businessId)) {
      await setActiveLocationCookie(businessId);
    }
  }
  redirect("/app");
}

/**
 * Add a location to the owner's org and switch to it (so they can set it up).
 * `org_id` is forced from the session-derived org, never client input.
 */
export async function addLocationAction(formData: FormData) {
  const { orgId } = await requireOwner();
  const parsed = locationSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) redirect("/app/locations?error=1");
  const org = createOrgRepo(orgId);
  const created = await org.createLocation(parsed.data);
  await setActiveLocationCookie(created.id);
  redirect("/app");
}
