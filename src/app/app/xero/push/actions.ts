"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { xeroClient, type XeroPayrollCalendar } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import {
  XeroPayrollAdminRequired,
  XeroReconnectRequired,
  XeroTimesheetAlreadyActioned,
} from "@/lib/xero/errors";
import { pushEmployeeTimesheet, cancelPush } from "@/lib/xero/push";
import { mondayOfWeek, toActivePayRules } from "@/lib/xero/pay-rules";
import { zonedDateTimeToUtc } from "@/lib/time";
import { logger } from "@/lib/logger";

const PATH = "/app/xero/push";

/** Next calendar day as YYYY-MM-DD (for an exclusive UTC window end). */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * Push every mapped, ready employee's approved hours for THEIR Xero pay period
 * as a DRAFT timesheet. Periods come straight from each employee's Xero calendar
 * (no local period math). Outcomes are tallied into the redirect flash.
 */
export async function pushAllAction(): Promise<void> {
  const owner = await requireOwner();
  const repo = createTenantRepo(owner.businessId);
  const connection = await repo.getXeroConnection();
  if (!connection || connection.status !== "active") {
    redirect(
      `${PATH}?error=${encodeURIComponent("Connect and confirm Xero first.")}`,
    );
  }
  const business = await repo.getBusiness();
  const tz = business?.timezone ?? "Australia/Sydney";
  const maps = await repo.listXeroEmployeeMaps();
  const rules = toActivePayRules(await repo.listPayRules());

  const tally = { pushed: 0, failed: 0, skipped: 0, blocked: 0 };
  const calCache = new Map<string, XeroPayrollCalendar | null>();
  let staleRuleName: string | null = null;

  try {
    const accessToken = await ensureFreshXeroAccessToken({
      repo,
      client: xeroClient,
      connection: connection!,
    });
    const tenantId = connection!.xeroTenantId;

    // Gate: every ACTIVE rule must point at a pay item that still exists in
    // Xero. A stale rule blocks the WHOLE push with a named, fixable error —
    // never a silent skip and never a cryptic Xero 400. (The redirect happens
    // AFTER this try block — `redirect()` throws, and the catch would eat it.)
    if (rules.length > 0) {
      const rates = await xeroClient.listEarningsRates(accessToken, tenantId);
      const known = new Set(rates.map((r) => r.earningsRateId));
      staleRuleName =
        rules.find((r) => !known.has(r.earningsRateId))?.name ?? null;
    }
    if (staleRuleName === null) {
      const getCal = async (id: string) => {
        if (!calCache.has(id)) {
          calCache.set(
            id,
            await xeroClient.getPayrollCalendar(accessToken, tenantId, id),
          );
        }
        return calCache.get(id) ?? null;
      };

      for (const m of maps) {
        if (!m.payrollCalendarId || !m.earningsRateId) {
          tally.blocked++;
          continue;
        }
        const cal = await getCal(m.payrollCalendarId);
        if (!cal?.periodStartDate || !cal?.periodEndDate) {
          tally.blocked++;
          continue;
        }
        // Fetch back to the Monday of the week containing the period start so
        // weekly rules see the whole business-local week; the classifier uses
        // pre-period entries as cumulation context only (they emit no lines).
        const startUtc = zonedDateTimeToUtc(
          mondayOfWeek(cal.periodStartDate),
          "00:00",
          tz,
        );
        const endUtc = zonedDateTimeToUtc(
          nextDay(cal.periodEndDate),
          "00:00",
          tz,
        );
        const entries = (
          await repo.listApprovedClosedEntriesForPush(startUtc, endUtc)
        ).filter((e) => e.staffMemberId === m.staffMemberId);

        const out = await pushEmployeeTimesheet({
          repo,
          client: xeroClient,
          accessToken,
          tenantId,
          businessId: owner.businessId,
          timezone: tz,
          staffMemberId: m.staffMemberId,
          xeroEmployeeId: m.xeroEmployeeId,
          earningsRateId: m.earningsRateId,
          payrollCalendarId: m.payrollCalendarId,
          periodStart: cal.periodStartDate,
          periodEnd: cal.periodEndDate,
          entries,
          rules,
        });
        if (out.status === "pushed" || out.status === "unchanged")
          tally.pushed++;
        else if (out.status === "skipped") tally.skipped++;
        else if (out.status === "blocked") tally.blocked++;
        else tally.failed++;
      }
    }
  } catch (err) {
    if (err instanceof XeroReconnectRequired) {
      redirect(
        `${PATH}?error=${encodeURIComponent("Xero needs reconnecting — see Settings.")}`,
      );
    }
    if (err instanceof XeroPayrollAdminRequired) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    logger.error({ err }, "Xero push-all failed");
    redirect(
      `${PATH}?error=${encodeURIComponent("Couldn’t push to Xero. Please try again.")}`,
    );
  }

  if (staleRuleName !== null) {
    redirect(
      `${PATH}?error=${encodeURIComponent(
        `The rule “${staleRuleName}” points at a pay item that no longer exists in Xero. Fix or turn it off on the Pay rules page, then push again.`,
      )}`,
    );
  }

  revalidatePath(PATH);
  redirect(
    `${PATH}?pushed=${tally.pushed}&failed=${tally.failed}&skipped=${tally.skipped}&blocked=${tally.blocked}`,
  );
}

/** Cancel one pushed draft (guard still-Draft; typed already-actioned error). */
export async function cancelPushAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const repo = createTenantRepo(owner.businessId);
  const pushId = String(formData.get("pushId") ?? "");
  const connection = await repo.getXeroConnection();
  if (!pushId || !connection || connection.status !== "active") {
    redirect(
      `${PATH}?error=${encodeURIComponent("Couldn’t cancel — reconnect Xero.")}`,
    );
  }
  try {
    const accessToken = await ensureFreshXeroAccessToken({
      repo,
      client: xeroClient,
      connection: connection!,
    });
    await cancelPush({
      repo,
      client: xeroClient,
      accessToken,
      tenantId: connection!.xeroTenantId,
      pushId,
    });
  } catch (err) {
    if (err instanceof XeroTimesheetAlreadyActioned) {
      redirect(`${PATH}?error=${encodeURIComponent(err.message)}`);
    }
    if (err instanceof XeroReconnectRequired) {
      redirect(
        `${PATH}?error=${encodeURIComponent("Xero needs reconnecting — see Settings.")}`,
      );
    }
    logger.error({ err }, "Xero cancel push failed");
    redirect(
      `${PATH}?error=${encodeURIComponent("Couldn’t cancel the draft. Please try again.")}`,
    );
  }
  revalidatePath(PATH);
  redirect(`${PATH}?cancelled=1`);
}
