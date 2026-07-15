"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/context";
import { createOrgRepo } from "@/lib/tenant/org-repository";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const loanSchema = z
  .object({
    staffMemberId: z.string().min(1),
    toBusinessId: z.string().min(1),
    startDate: isoDate,
    endDate: isoDate,
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must be on or after the start date",
  });

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

/** Lend a person to a location for a date range (M29 Phase 4). */
export async function createLoanAction(formData: FormData) {
  const { orgId } = await requireOwner();
  const parsed = loanSchema.safeParse({
    staffMemberId: formData.get("staffMemberId"),
    toBusinessId: formData.get("toBusinessId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) redirect("/app/people?loanError=dates");
  const res = await createOrgRepo(orgId).createLoan({
    staffMemberId: parsed.data.staffMemberId,
    toBusinessId: parsed.data.toBusinessId,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    note: parsed.data.note ?? null,
  });
  if (!res.ok) {
    redirect(`/app/people?loanError=${encodeURIComponent(res.reason ?? "1")}`);
  }
  revalidatePath("/app/people");
  redirect("/app/people?loaned=1");
}

/** End a loan now (deactivates the loan-created membership). */
export async function endLoanAction(formData: FormData) {
  const { orgId } = await requireOwner();
  const loanId = formData.get("loanId");
  if (typeof loanId === "string" && loanId) {
    await createOrgRepo(orgId).endLoan(loanId);
  }
  revalidatePath("/app/people");
}
