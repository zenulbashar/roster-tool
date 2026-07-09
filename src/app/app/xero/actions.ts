"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { xeroClient } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import { resolveOrdinaryEarningsRate } from "@/lib/xero/resolve";

const PATH = "/app/xero";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

/**
 * Map a staff member to a Xero employee. The employee's name + pay calendar are
 * re-read server-side from Xero (never trusted from the form). The ordinary
 * earnings rate is the owner's override if given, else auto-resolved from the
 * employee's pay template (unresolved ⇒ null ⇒ that person is blocked from push
 * until the owner picks one).
 */
export async function saveMappingAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  const xeroEmployeeId = String(formData.get("xeroEmployeeId") ?? "");
  const rateOverride = String(formData.get("earningsRateId") ?? "");
  if (!staffMemberId || !xeroEmployeeId) fail("Pick a Xero employee to map.");

  const connection = await repo.getXeroConnection();
  if (!connection || connection.status !== "active") {
    fail("Connect and confirm Xero first.");
  }
  const accessToken = await ensureFreshXeroAccessToken({
    repo,
    client: xeroClient,
    connection: connection!,
  });
  const tenantId = connection!.xeroTenantId;

  const employees = await xeroClient.listEmployees(accessToken, tenantId);
  const emp = employees.find((e) => e.employeeId === xeroEmployeeId);
  if (!emp) fail("That Xero employee could not be found — try again.");

  const rates = await xeroClient.listEarningsRates(accessToken, tenantId);
  let earningsRateId: string | null;
  if (rateOverride) {
    earningsRateId = rateOverride;
  } else {
    const payTemplate = await xeroClient.getEmployeePayTemplateEarnings(
      accessToken,
      tenantId,
      emp!.employeeId,
    );
    earningsRateId = resolveOrdinaryEarningsRate({
      payTemplateEarnings: payTemplate,
      orgEarningsRates: rates,
    }).earningsRateId;
  }

  await repo.upsertXeroEmployeeMap({
    staffMemberId,
    xeroEmployeeId: emp!.employeeId,
    xeroEmployeeName: `${emp!.firstName} ${emp!.lastName}`.trim(),
    earningsRateId,
    payrollCalendarId: emp!.payrollCalendarId,
  });
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

/** Remove a staff member's Xero mapping. */
export async function removeMappingAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const staffMemberId = String(formData.get("staffMemberId") ?? "");
  if (staffMemberId) await repo.deleteXeroEmployeeMap(staffMemberId);
  revalidatePath(PATH);
  redirect(PATH);
}
