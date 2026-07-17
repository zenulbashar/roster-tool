import { requireOwner } from "@/lib/auth/context";
import { createTenantRepo } from "@/lib/tenant/repository";
import { redirect } from "next/navigation";
import { xeroClient, type XeroEarningsRate } from "@/lib/xero/client";
import { ensureFreshXeroAccessToken } from "@/lib/xero/service";
import {
  XeroPayrollAdminRequired,
  XeroReconnectRequired,
} from "@/lib/xero/errors";
import {
  describePayRuleCondition,
  parsePayRuleCondition,
  type PayRuleConditionType,
} from "@/lib/xero/pay-rules";
import { logger } from "@/lib/logger";
import {
  Badge,
  Banner,
  ButtonLink,
  Card,
  PageHeader,
  SectionCard,
} from "@/components/ui";
import {
  deletePayRuleAction,
  movePayRuleAction,
  togglePayRuleAction,
} from "./actions";
import { PayRuleForm, type RuleFormInitial } from "./rule-form";

export const dynamic = "force-dynamic";

/**
 * The owner's pay-classification rules. Rules are the OWNER's own mechanical
 * mappings (condition → one of THEIR Xero pay items); Roster ships none, and
 * this page's copy never suggests Roster knows what the rates should be.
 */
export default async function XeroRulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    deleted?: string;
    error?: string;
    edit?: string;
    new?: string;
  }>;
}) {
  const sp = await searchParams;
  const owner = await requireOwner();
  const repo = createTenantRepo(owner.businessId);
  const business = await repo.getBusiness();
  if (!business) redirect("/onboarding");

  const connection = await repo.getXeroConnection();
  if (!connection) {
    return (
      <Gate
        title="Connect Xero first"
        body="Link your Xero organisation in Settings, then come back to set up pay rules for pushed hours."
      />
    );
  }
  if (connection.status === "pending_confirmation") {
    return (
      <Gate
        title="Confirm your Xero organisation"
        body="Your Xero connection is waiting for you to confirm the organisation name in Settings before you can set up rules."
      />
    );
  }
  if (connection.needsReconnect) {
    return (
      <Gate
        title="Reconnect Xero"
        body="Your Xero access expired or was revoked. Reconnect in Settings to manage pay rules."
      />
    );
  }

  // Live pay items — the only thing a rule can point at.
  let rates: XeroEarningsRate[] = [];
  let loadError: string | null = null;
  try {
    const accessToken = await ensureFreshXeroAccessToken({
      repo,
      client: xeroClient,
      connection,
    });
    rates = await xeroClient.listEarningsRates(
      accessToken,
      connection.xeroTenantId,
    );
  } catch (err) {
    if (err instanceof XeroReconnectRequired) {
      return (
        <Gate
          title="Reconnect Xero"
          body="Your Xero access expired or was revoked. Reconnect in Settings to continue."
        />
      );
    }
    if (err instanceof XeroPayrollAdminRequired) loadError = err.message;
    else {
      logger.error({ err }, "Xero pay items load failed");
      loadError = "Couldn’t load pay items from Xero. Please try again.";
    }
  }
  const liveRateIds = new Set(rates.map((r) => r.earningsRateId));
  const liveRateName = (id: string) =>
    rates.find((r) => r.earningsRateId === id)?.name ?? null;

  const rules = await repo.listPayRules();
  const editing = sp.edit ? rules.find((r) => r.id === sp.edit) : undefined;
  const showForm = Boolean(sp.new) || Boolean(editing);
  const initial: RuleFormInitial | null = editing ? toInitial(editing) : null;

  return (
    <>
      <PageHeader
        title="Pay rules"
        subtitle={`Connected to ${connection.orgName}. Your rules sort pushed hours into your own Xero pay items — Roster sets no rates and calculates no pay.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href="/app/xero/push" variant="secondary">
              Push hours
            </ButtonLink>
            {!showForm ? (
              <ButtonLink href="/app/xero/rules?new=1">Add rule</ButtonLink>
            ) : null}
          </div>
        }
      />

      {sp.saved ? <Banner tone="success">Rule saved.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Rule deleted.</Banner> : null}
      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {loadError ? <Banner tone="warn">{loadError}</Banner> : null}

      <Banner tone="info">
        Rules are yours: each one moves matching hours onto a{" "}
        <strong>pay item you set up in Xero</strong>, and that pay item decides
        every dollar. Hours with no matching rule use each person’s ordinary pay
        item. When more than one rule matches the same hours,{" "}
        <strong>the one higher in this list applies</strong> — use the arrows to
        reorder. Every push still lands in Xero as a draft for you to check.
      </Banner>

      {showForm ? (
        <SectionCard title={editing ? "Edit rule" : "Add a rule"}>
          <PayRuleForm
            rates={rates.map((r) => ({
              earningsRateId: r.earningsRateId,
              name: r.name,
            }))}
            initial={initial}
          />
        </SectionCard>
      ) : null}

      <Card padded={false}>
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[44px_1.2fr_1.4fr_1.2fr_auto] items-center gap-3 border-b border-[#F1F3F5] bg-[#FAFBFC] px-[18px] py-[11px] text-[11px] font-bold uppercase tracking-[.06em] text-[#6B7280]">
              <span>#</span>
              <span>Rule</span>
              <span>Applies to</span>
              <span>Xero pay item</span>
              <span className="text-right">Actions</span>
            </div>
            {rules.length === 0 ? (
              <div className="px-[18px] py-[26px] text-center text-[13px] leading-[1.6] text-[#6B7280]">
                No rules yet. Without rules, every pushed hour uses each
                person’s ordinary pay item — exactly as before. Add a rule to
                sort matching hours onto another of your Xero pay items.
              </div>
            ) : (
              rules.map((r, i) => {
                const condition = parsePayRuleCondition(
                  r.conditionType as PayRuleConditionType,
                  r.conditionConfig,
                );
                const stale =
                  rates.length > 0 && !liveRateIds.has(r.earningsRateId);
                return (
                  <div
                    key={r.id}
                    className="grid grid-cols-[44px_1.2fr_1.4fr_1.2fr_auto] items-center gap-3 border-b border-[#F5F6F7] px-[18px] py-[12px]"
                  >
                    <span className="font-archivo text-[13px] font-bold tabular-nums text-[#9CA3AF]">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold text-[#111827]">
                        {r.name}
                      </div>
                      {!r.isActive ? (
                        <span className="text-[11px] text-[#9CA3AF]">
                          Off — not applied to pushes
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[12.5px] text-[#374151]">
                      {condition
                        ? describePayRuleCondition(condition)
                        : "Unreadable rule — edit and re-save it"}
                    </span>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[12.5px] text-[#374151]">
                        {liveRateName(r.earningsRateId) ?? r.earningsRateName}
                      </span>
                      {stale ? (
                        <Badge tone="danger">Missing in Xero</Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-end gap-[6px]">
                      <form action={movePayRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input type="hidden" name="direction" value="up" />
                        <RowIconButton
                          label={`Move ${r.name} up`}
                          disabled={i === 0}
                          icon="arrow_upward"
                        />
                      </form>
                      <form action={movePayRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input type="hidden" name="direction" value="down" />
                        <RowIconButton
                          label={`Move ${r.name} down`}
                          disabled={i === rules.length - 1}
                          icon="arrow_downward"
                        />
                      </form>
                      <form action={togglePayRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input
                          type="hidden"
                          name="to"
                          value={r.isActive ? "off" : "on"}
                        />
                        <button
                          type="submit"
                          className={`rounded-[7px] border px-[10px] py-[6px] text-[11.5px] font-semibold ${
                            r.isActive
                              ? "border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB]"
                              : "border-[var(--color-button)] bg-[#F3FAE7] text-[#13301F]"
                          }`}
                        >
                          {r.isActive ? "Turn off" : "Turn on"}
                        </button>
                      </form>
                      <ButtonLink
                        href={`/app/xero/rules?edit=${r.id}`}
                        variant="secondary"
                      >
                        Edit
                      </ButtonLink>
                      <form action={deletePayRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <button
                          type="submit"
                          className="rounded-[7px] border border-[#E5E7EB] bg-white px-[10px] py-[6px] text-[11.5px] font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Card>

      <p className="mt-[14px] max-w-[720px] text-[12px] leading-[1.6] text-[#9CA3AF]">
        Rules run over recorded clock times when you push approved hours, and
        the pre-push preview shows exactly how each shift was split before
        anything is sent. Deleting or changing a rule never touches hours
        already pushed — re-push a period to apply the change.
      </p>
    </>
  );
}

/** Small square icon submit button (Material Symbols), used for reordering. */
function RowIconButton({
  label,
  icon,
  disabled,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="grid h-[30px] w-[30px] place-items-center rounded-[7px] border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] disabled:cursor-default disabled:opacity-35"
    >
      <span aria-hidden className="material-symbols-rounded text-[17px]">
        {icon}
      </span>
    </button>
  );
}

function toInitial(rule: {
  id: string;
  name: string;
  conditionType: string;
  conditionConfig: unknown;
  earningsRateId: string;
}): RuleFormInitial {
  const condition = parsePayRuleCondition(
    rule.conditionType as PayRuleConditionType,
    rule.conditionConfig,
  );
  return {
    id: rule.id,
    name: rule.name,
    conditionType:
      (rule.conditionType as PayRuleConditionType) ?? "day_of_week",
    days: condition?.type === "day_of_week" ? condition.days : [],
    time:
      condition?.type === "time_of_day_after" ||
      condition?.type === "time_of_day_before"
        ? condition.time
        : "",
    hours:
      condition?.type === "daily_hours_beyond" ||
      condition?.type === "weekly_hours_beyond"
        ? condition.hours
        : null,
    earningsRateId: rule.earningsRateId,
  };
}

function Gate({ title, body }: { title: string; body: string }) {
  return (
    <>
      <PageHeader title="Pay rules" />
      <Card>
        <div className="py-[10px] text-center">
          <h2 className="font-archivo text-[17px] font-bold text-[#111827]">
            {title}
          </h2>
          <p className="mx-auto mt-[8px] max-w-[420px] text-[13px] leading-[1.6] text-[#6B7280]">
            {body}
          </p>
          <div className="mt-[16px]">
            <ButtonLink href="/app/settings">Go to Settings</ButtonLink>
          </div>
        </div>
      </Card>
    </>
  );
}
