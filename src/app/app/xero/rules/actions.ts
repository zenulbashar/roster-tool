"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ownerRepo } from "@/lib/auth/context";
import { xeroClient } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import {
  PAY_RULE_CONDITION_TYPES,
  payRuleConditionConfigSchemas,
  type PayRuleConditionType,
} from "@/lib/xero/pay-rules";

/**
 * Owner actions for pay-classification rules. Everything is tenant-scoped via
 * `ownerRepo()`; the condition config is zod-validated per type; and the pay
 * item is re-validated against the org's LIVE earnings rates server-side (the
 * snapshot name comes from Xero's answer, never the form). No rate, multiplier
 * or dollar figure exists to store — a rule is only a mapping.
 */

const PATH = "/app/xero/rules";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

const nameSchema = z.string().trim().min(1).max(80);

/** FormData → validated {type, config}; redirects with a message on bad input. */
function readCondition(formData: FormData): {
  conditionType: PayRuleConditionType;
  conditionConfig: unknown;
} {
  const type = String(formData.get("conditionType") ?? "");
  if (!(PAY_RULE_CONDITION_TYPES as readonly string[]).includes(type)) {
    fail("Pick what the rule should match on.");
  }
  const conditionType = type as PayRuleConditionType;
  let raw: unknown;
  if (conditionType === "day_of_week") {
    raw = { days: formData.getAll("days").map((d) => Number(d)) };
  } else if (
    conditionType === "time_of_day_after" ||
    conditionType === "time_of_day_before"
  ) {
    raw = { time: String(formData.get("time") ?? "") };
  } else {
    raw = { hours: Number(formData.get("hours")) };
  }
  const parsed = payRuleConditionConfigSchemas[conditionType].safeParse(raw);
  if (!parsed.success) {
    fail(
      conditionType === "day_of_week"
        ? "Pick at least one day of the week."
        : conditionType.startsWith("time_of_day")
          ? "Enter a time of day for the rule."
          : "Enter the number of hours (more than 0).",
    );
  }
  return { conditionType, conditionConfig: parsed.data };
}

/** Validate the chosen pay item against Xero and return its live name. */
async function resolvePayItem(
  repo: Awaited<ReturnType<typeof ownerRepo>>,
  earningsRateId: string,
): Promise<string> {
  const connection = await repo.getXeroConnection();
  if (!connection || connection.status !== "active") {
    fail("Connect and confirm Xero first.");
  }
  const accessToken = await ensureFreshXeroAccessToken({
    repo,
    client: xeroClient,
    connection: connection!,
  });
  const rates = await xeroClient.listEarningsRates(
    accessToken,
    connection!.xeroTenantId,
  );
  const rate = rates.find((r) => r.earningsRateId === earningsRateId);
  if (!rate) fail("Pick which of your Xero pay items these hours should use.");
  return rate!.name;
}

export async function createPayRuleAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) fail("Give the rule a short name.");
  const { conditionType, conditionConfig } = readCondition(formData);
  const earningsRateId = String(formData.get("earningsRateId") ?? "");
  if (!earningsRateId) fail("Pick which of your Xero pay items to use.");
  const earningsRateName = await resolvePayItem(repo, earningsRateId);

  await repo.createPayRule({
    name: name.data,
    conditionType,
    conditionConfig,
    earningsRateId,
    earningsRateName,
  });
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

export async function updatePayRuleAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const id = String(formData.get("ruleId") ?? "");
  const existing = id ? await repo.getPayRule(id) : null;
  if (!existing) fail("That rule no longer exists.");
  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) fail("Give the rule a short name.");
  const { conditionType, conditionConfig } = readCondition(formData);
  const earningsRateId = String(formData.get("earningsRateId") ?? "");
  if (!earningsRateId) fail("Pick which of your Xero pay items to use.");
  const earningsRateName = await resolvePayItem(repo, earningsRateId);

  await repo.updatePayRule(existing!.id, {
    name: name.data,
    conditionType,
    conditionConfig,
    earningsRateId,
    earningsRateName,
    isActive: existing!.isActive, // the on/off switch is its own action
  });
  revalidatePath(PATH);
  redirect(`${PATH}?saved=1`);
}

export async function togglePayRuleAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const id = String(formData.get("ruleId") ?? "");
  const to = String(formData.get("to") ?? "") === "on";
  if (id) await repo.setPayRuleActive(id, to);
  revalidatePath(PATH);
  redirect(PATH);
}

export async function movePayRuleAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const id = String(formData.get("ruleId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (id && (direction === "up" || direction === "down")) {
    await repo.movePayRule(id, direction);
  }
  revalidatePath(PATH);
  redirect(PATH);
}

export async function deletePayRuleAction(formData: FormData): Promise<void> {
  const repo = await ownerRepo();
  const id = String(formData.get("ruleId") ?? "");
  if (id) await repo.deletePayRule(id);
  revalidatePath(PATH);
  redirect(`${PATH}?deleted=1`);
}
