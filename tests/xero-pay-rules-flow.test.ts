import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, payRules } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { toActivePayRules } from "@/lib/xero/pay-rules";

/**
 * Integration coverage of the pay-rule store against the real DB: CRUD,
 * explicit owner-visible precedence (create-at-end, move up/down), tenant
 * isolation, and the two boundary facts — a fresh business has ZERO rules
 * (the table ships empty) and the table stores no rate/multiplier/dollar
 * column (pinned in the boundary test file; here we just round-trip).
 */

describe("pay rule persistence", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Rules Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Rules Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("a fresh business has ZERO rules — the table ships empty", async () => {
    expect(await repoA.listPayRules()).toEqual([]);
    // And globally: nothing seeded these businesses' rules behind our back.
    const any = await db
      .select()
      .from(payRules)
      .where(eq(payRules.businessId, businessB));
    expect(any).toEqual([]);
  });

  it("creates rules at the end of the precedence list, round-tripping the config", async () => {
    const first = await repoA.createPayRule({
      name: "Saturday hours",
      conditionType: "day_of_week",
      conditionConfig: { days: [6] },
      earningsRateId: "rate-sat",
      earningsRateName: "Saturday item",
    });
    expect(first.priority).toBe(1);
    expect(first.isActive).toBe(true);

    const second = await repoA.createPayRule({
      name: "Late hours",
      conditionType: "time_of_day_after",
      conditionConfig: { time: "22:00" },
      earningsRateId: "rate-late",
      earningsRateName: "Late item",
    });
    expect(second.priority).toBe(2);

    const list = await repoA.listPayRules();
    expect(list.map((r) => r.name)).toEqual(["Saturday hours", "Late hours"]);
    expect(list[0]!.conditionConfig).toEqual({ days: [6] });
    expect(list[1]!.conditionConfig).toEqual({ time: "22:00" });

    // The stored rows parse straight into evaluable rules.
    const active = toActivePayRules(list);
    expect(active).toHaveLength(2);
    expect(active[0]!.condition).toEqual({ type: "day_of_week", days: [6] });
  });

  it("updates a rule's fields and toggles active without moving it", async () => {
    const list = await repoA.listPayRules();
    const late = list.find((r) => r.name === "Late hours")!;
    const updated = await repoA.updatePayRule(late.id, {
      name: "Night hours",
      conditionType: "time_of_day_after",
      conditionConfig: { time: "23:00" },
      earningsRateId: "rate-night",
      earningsRateName: "Night item",
      isActive: true,
    });
    expect(updated!.name).toBe("Night hours");
    expect(updated!.conditionConfig).toEqual({ time: "23:00" });
    expect(updated!.priority).toBe(late.priority); // never moved by update

    const off = await repoA.setPayRuleActive(late.id, false);
    expect(off!.isActive).toBe(false);
    // Inactive rules stay in the list but drop out of evaluation.
    expect(toActivePayRules(await repoA.listPayRules())).toHaveLength(1);
    await repoA.setPayRuleActive(late.id, true);
  });

  it("movePayRule swaps neighbours and clamps at the ends", async () => {
    const before = await repoA.listPayRules();
    expect(before.map((r) => r.name)).toEqual(["Saturday hours", "Night hours"]);

    await repoA.movePayRule(before[1]!.id, "up");
    const after = await repoA.listPayRules();
    expect(after.map((r) => r.name)).toEqual(["Night hours", "Saturday hours"]);
    expect(after.map((r) => r.priority)).toEqual([1, 2]);

    // Moving the top rule up (or bottom down) is a no-op, not an error.
    await repoA.movePayRule(after[0]!.id, "up");
    await repoA.movePayRule(after[1]!.id, "down");
    const clamped = await repoA.listPayRules();
    expect(clamped.map((r) => r.name)).toEqual([
      "Night hours",
      "Saturday hours",
    ]);
  });

  it("is tenant-isolated: B can't see, edit, move or delete A's rules", async () => {
    const [aRule] = await repoA.listPayRules();
    expect(await repoB.listPayRules()).toEqual([]);
    expect(await repoB.getPayRule(aRule!.id)).toBeNull();
    expect(
      await repoB.updatePayRule(aRule!.id, {
        name: "hijack",
        conditionType: "day_of_week",
        conditionConfig: { days: [1] },
        earningsRateId: "x",
        earningsRateName: "x",
        isActive: true,
      }),
    ).toBeNull();
    expect(await repoB.setPayRuleActive(aRule!.id, false)).toBeNull();
    expect(await repoB.movePayRule(aRule!.id, "down")).toBeNull();
    expect(await repoB.deletePayRule(aRule!.id)).toBeNull();
    // A's rule is untouched.
    expect((await repoA.getPayRule(aRule!.id))!.name).toBe(aRule!.name);
  });

  it("deletes a rule; the rest keep a stable, explicit order", async () => {
    const list = await repoA.listPayRules();
    const gone = await repoA.deletePayRule(list[0]!.id);
    expect(gone!.id).toBe(list[0]!.id);
    const rest = await repoA.listPayRules();
    expect(rest.map((r) => r.name)).toEqual(["Saturday hours"]);
    expect(await repoA.getPayRule(list[0]!.id)).toBeNull();
  });
});
