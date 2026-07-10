"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui";
import type { PayRuleConditionType } from "@/lib/xero/pay-rules";
import { createPayRuleAction, updatePayRuleAction } from "./actions";

/**
 * Add/edit form for ONE pay rule. Client-side only for showing the right
 * condition inputs for the chosen type — all validation and the pay-item
 * name snapshot happen server-side in the actions. The form never carries a
 * rate, percentage or dollar amount; the only pay reference is WHICH of the
 * owner's Xero pay items the hours should use.
 */

type RateOption = { earningsRateId: string; name: string };

export type RuleFormInitial = {
  id: string;
  name: string;
  conditionType: PayRuleConditionType;
  days: number[];
  time: string;
  hours: number | null;
  earningsRateId: string;
};

const CONDITION_LABELS: Array<{ value: PayRuleConditionType; label: string }> =
  [
    { value: "day_of_week", label: "Hours on certain days of the week" },
    { value: "time_of_day_after", label: "Hours after a time of day" },
    { value: "time_of_day_before", label: "Hours before a time of day" },
    { value: "daily_hours_beyond", label: "Hours beyond a total in one day" },
    {
      value: "weekly_hours_beyond",
      label: "Hours beyond a total in one week (Mon–Sun)",
    },
  ];

const DAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const inputCls =
  "w-full rounded-[8px] border border-[#E5E7EB] bg-white px-[10px] py-[8px] text-[13px] text-[#374151] outline-none focus:border-[var(--color-button)]";
const labelCls =
  "mb-[6px] block text-[11.5px] font-bold uppercase tracking-[.05em] text-[#6B7280]";

export function PayRuleForm({
  rates,
  initial,
}: {
  rates: RateOption[];
  initial: RuleFormInitial | null;
}) {
  const [conditionType, setConditionType] = useState<PayRuleConditionType>(
    initial?.conditionType ?? "day_of_week",
  );
  const isTime =
    conditionType === "time_of_day_after" ||
    conditionType === "time_of_day_before";
  const isHours =
    conditionType === "daily_hours_beyond" ||
    conditionType === "weekly_hours_beyond";

  return (
    <form
      action={initial ? updatePayRuleAction : createPayRuleAction}
      className="grid gap-[14px]"
    >
      {initial ? (
        <input type="hidden" name="ruleId" value={initial.id} />
      ) : null}

      <div className="grid gap-[14px] sm:grid-cols-2">
        <div>
          <label htmlFor="rule-name" className={labelCls}>
            Rule name
          </label>
          <input
            id="rule-name"
            name="name"
            defaultValue={initial?.name ?? ""}
            required
            maxLength={80}
            placeholder="e.g. Saturday hours"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="rule-condition" className={labelCls}>
            When does it apply?
          </label>
          <select
            id="rule-condition"
            name="conditionType"
            value={conditionType}
            onChange={(e) =>
              setConditionType(e.target.value as PayRuleConditionType)
            }
            className={inputCls}
          >
            {CONDITION_LABELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {conditionType === "day_of_week" ? (
        <fieldset>
          <legend className={labelCls}>Days it applies to</legend>
          <div className="flex flex-wrap gap-[8px]">
            {DAYS.map((d) => (
              <label
                key={d.value}
                className="flex cursor-pointer items-center gap-[6px] rounded-[8px] border border-[#E5E7EB] bg-white px-[10px] py-[7px] text-[12.5px] font-semibold text-[#374151] has-checked:border-[var(--color-button)] has-checked:bg-[#F3FAE7]"
              >
                <input
                  type="checkbox"
                  name="days"
                  value={d.value}
                  defaultChecked={initial?.days.includes(d.value) ?? false}
                  className="accent-[var(--color-button)]"
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {isTime ? (
        <div className="max-w-[220px]">
          <label htmlFor="rule-time" className={labelCls}>
            {conditionType === "time_of_day_after"
              ? "Hours worked at or after"
              : "Hours worked before"}
          </label>
          <input
            id="rule-time"
            type="time"
            name="time"
            defaultValue={initial?.time || "22:00"}
            required
            className={inputCls}
          />
        </div>
      ) : null}

      {isHours ? (
        <div className="max-w-[220px]">
          <label htmlFor="rule-hours" className={labelCls}>
            {conditionType === "daily_hours_beyond"
              ? "Hours in one day beyond"
              : "Hours in one week beyond"}
          </label>
          <input
            id="rule-hours"
            type="number"
            name="hours"
            defaultValue={
              initial?.hours ??
              (conditionType === "daily_hours_beyond" ? 8 : 38)
            }
            min={0.25}
            max={conditionType === "daily_hours_beyond" ? 24 : 168}
            step={0.25}
            required
            className={inputCls}
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="rule-rate" className={labelCls}>
          Xero pay item those hours use
        </label>
        <select
          id="rule-rate"
          name="earningsRateId"
          defaultValue={initial?.earningsRateId ?? ""}
          required
          disabled={rates.length === 0}
          className={inputCls}
        >
          <option value="">— Pick a pay item —</option>
          {rates.map((r) => (
            <option key={r.earningsRateId} value={r.earningsRateId}>
              {r.name}
            </option>
          ))}
        </select>
        <p className="mt-[6px] text-[12px] leading-[1.5] text-[#9CA3AF]">
          The rate for these hours is whatever this pay item is set to in Xero.
          Roster stores no amount and no percentage.
        </p>
      </div>

      <div className="flex items-center gap-[10px]">
        <Button type="submit">{initial ? "Save rule" : "Add rule"}</Button>
        {initial ? (
          <ButtonLink href="/app/xero/rules" variant="secondary">
            Cancel
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}
