import { describe, expect, it } from "vitest";
import {
  earningsRateName,
  resolveOrdinaryEarningsRate,
  type OrgEarningsRate,
} from "@/lib/xero/resolve";

/** Pure earnings-rate resolution (#15) — the ordinary rate is the employee's
 * pay-template RegularEarnings line, else a sole org RegularEarnings rate, else
 * unresolved (owner picks; blocked until then). No I/O. */

const RATES: OrgEarningsRate[] = [
  {
    earningsRateId: "ord",
    name: "Ordinary Hours",
    earningsType: "RegularEarnings",
  },
  {
    earningsRateId: "ot",
    name: "Overtime x1.5",
    earningsType: "OvertimeEarnings",
  },
  {
    earningsRateId: "allow",
    name: "Meal Allowance",
    earningsType: "Allowance",
  },
];

describe("resolveOrdinaryEarningsRate", () => {
  it("uses the employee's pay-template RegularEarnings line", () => {
    const r = resolveOrdinaryEarningsRate({
      payTemplateEarnings: [
        { earningsRateId: "ot" },
        { earningsRateId: "ord" },
      ],
      orgEarningsRates: RATES,
    });
    expect(r).toEqual({
      earningsRateId: "ord",
      name: "Ordinary Hours",
      reason: "from_pay_template",
    });
  });

  it("never picks an overtime/allowance line even if it's the only one", () => {
    const r = resolveOrdinaryEarningsRate({
      payTemplateEarnings: [{ earningsRateId: "ot" }],
      orgEarningsRates: RATES,
    });
    // Template has no regular line, but the org has exactly one → fall back.
    expect(r.earningsRateId).toBe("ord");
    expect(r.reason).toBe("sole_regular_rate");
  });

  it("falls back to the sole org RegularEarnings rate when the template has none", () => {
    const r = resolveOrdinaryEarningsRate({
      payTemplateEarnings: [],
      orgEarningsRates: RATES,
    });
    expect(r).toEqual({
      earningsRateId: "ord",
      name: "Ordinary Hours",
      reason: "sole_regular_rate",
    });
  });

  it("is UNRESOLVED (blocked) when the org has multiple regular rates and the template has none", () => {
    const twoRegular: OrgEarningsRate[] = [
      {
        earningsRateId: "ord1",
        name: "Ordinary A",
        earningsType: "RegularEarnings",
      },
      {
        earningsRateId: "ord2",
        name: "Ordinary B",
        earningsType: "RegularEarnings",
      },
    ];
    const r = resolveOrdinaryEarningsRate({
      payTemplateEarnings: [{ earningsRateId: "unknown" }],
      orgEarningsRates: twoRegular,
    });
    expect(r).toEqual({
      earningsRateId: null,
      name: null,
      reason: "unresolved",
    });
  });

  it("is UNRESOLVED when there are no regular rates at all", () => {
    const r = resolveOrdinaryEarningsRate({
      payTemplateEarnings: [{ earningsRateId: "ot" }],
      orgEarningsRates: [RATES[1]!, RATES[2]!], // no RegularEarnings
    });
    expect(r.reason).toBe("unresolved");
    expect(r.earningsRateId).toBeNull();
  });

  it("matches earningsType case-insensitively", () => {
    const r = resolveOrdinaryEarningsRate({
      payTemplateEarnings: [{ earningsRateId: "x" }],
      orgEarningsRates: [
        { earningsRateId: "x", name: "Reg", earningsType: "regularearnings" },
      ],
    });
    expect(r.earningsRateId).toBe("x");
    expect(r.reason).toBe("from_pay_template");
  });

  it("earningsRateName looks up an owner-overridden id", () => {
    expect(earningsRateName("ot", RATES)).toBe("Overtime x1.5");
    expect(earningsRateName(null, RATES)).toBeNull();
    expect(earningsRateName("nope", RATES)).toBeNull();
  });
});
