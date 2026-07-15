"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/context";
import { createOrgRepo } from "@/lib/tenant/org-repository";

/**
 * Org-level people/membership actions. The org is session-derived; the org repo
 * validates that BOTH the person and the location belong to it (N3) before
 * touching a membership, so a forged id is a no-op.
 */

export async function addPersonToLocationAction(formData: FormData) {
  const { orgId } = await requireOwner();
  const staffMemberId = formData.get("staffMemberId");
  const businessId = formData.get("businessId");
  if (typeof staffMemberId === "string" && typeof businessId === "string") {
    await createOrgRepo(orgId).addPersonToLocation(staffMemberId, businessId);
  }
  revalidatePath("/app/people");
}

export async function removePersonFromLocationAction(formData: FormData) {
  const { orgId } = await requireOwner();
  const staffMemberId = formData.get("staffMemberId");
  const businessId = formData.get("businessId");
  if (typeof staffMemberId === "string" && typeof businessId === "string") {
    await createOrgRepo(orgId).removePersonFromLocation(
      staffMemberId,
      businessId,
    );
  }
  revalidatePath("/app/people");
}
