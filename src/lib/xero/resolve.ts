/**
 * Pure earnings-rate resolution for the staff↔Xero-employee mapping (#15).
 *
 * Locked decision (a): the ordinary earnings rate is auto-resolved from the
 * employee's Xero PAY TEMPLATE, shown + editable on the pre-push preview, and an
 * UNRESOLVED rate blocks that employee from push (never a silent guess). This
 * module is the pure core — no I/O — so it is exhaustively unit-testable.
 *
 * "Ordinary" is defined by Xero's own `EarningsRate.earningsType === "RegularEarnings"`
 * (verified from the Payroll 2.0 EarningsRate model). We look at the employee's
 * pay-template earnings lines and pick the one whose rate is a RegularEarnings
 * rate. Overtime/penalty/allowance rates are deliberately NOT chosen — those are
 * the human's job in Xero (consistent with "single ordinary earnings rate").
 */

/** The org's earnings rates (from GET /PayItems), trimmed to what we use. */
export type OrgEarningsRate = {
  earningsRateId: string;
  name: string;
  /** Xero EarningsType, e.g. "RegularEarnings", "OvertimeEarnings", … */
  earningsType: string;
};

/** One earnings line on an employee's pay template (from PayTemplateEarnings). */
export type PayTemplateEarning = {
  earningsRateId: string;
};

export type ResolvedEarningsRate = {
  earningsRateId: string | null;
  name: string | null;
  /** Why this resolution happened — surfaced to the owner on the preview. */
  reason:
    | "from_pay_template" // a RegularEarnings line on the employee's template
    | "sole_regular_rate" // template had none, but the org has exactly one
    | "unresolved"; // owner must pick, else this employee is blocked
};

const REGULAR = "regularearnings";

/**
 * Resolve the ordinary earnings rate for an employee.
 *
 * 1. If the employee's pay template has a line whose rate is a RegularEarnings
 *    rate, use it (the accurate, per-employee answer).
 * 2. Else, if the org has EXACTLY ONE RegularEarnings rate, fall back to it.
 * 3. Else leave it unresolved — the owner selects one on the preview, and until
 *    they do, that employee is blocked from push.
 *
 * The owner can always override the result on the preview; this is the default.
 */
export function resolveOrdinaryEarningsRate(input: {
  payTemplateEarnings: PayTemplateEarning[];
  orgEarningsRates: OrgEarningsRate[];
}): ResolvedEarningsRate {
  const byId = new Map(
    input.orgEarningsRates.map((r) => [r.earningsRateId, r]),
  );
  const isRegular = (rateId: string) =>
    byId.get(rateId)?.earningsType?.toLowerCase() === REGULAR;

  // 1. A RegularEarnings line on the employee's own pay template.
  const templateRegular = input.payTemplateEarnings.find((l) =>
    isRegular(l.earningsRateId),
  );
  if (templateRegular) {
    const rate = byId.get(templateRegular.earningsRateId)!;
    return {
      earningsRateId: rate.earningsRateId,
      name: rate.name,
      reason: "from_pay_template",
    };
  }

  // 2. The org has exactly one RegularEarnings rate → a safe default.
  const regulars = input.orgEarningsRates.filter(
    (r) => r.earningsType?.toLowerCase() === REGULAR,
  );
  if (regulars.length === 1) {
    const rate = regulars[0]!;
    return {
      earningsRateId: rate.earningsRateId,
      name: rate.name,
      reason: "sole_regular_rate",
    };
  }

  // 3. Ambiguous / none → owner must choose; blocked until then.
  return { earningsRateId: null, name: null, reason: "unresolved" };
}

/** Look up an earnings-rate display name by id (for showing an owner override). */
export function earningsRateName(
  earningsRateId: string | null,
  orgEarningsRates: OrgEarningsRate[],
): string | null {
  if (!earningsRateId) return null;
  return (
    orgEarningsRates.find((r) => r.earningsRateId === earningsRateId)?.name ??
    null
  );
}
