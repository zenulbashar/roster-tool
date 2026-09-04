import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";

/**
 * COR-08: the hour-threshold basis is a per-business setting the owner sees
 * and controls. New businesses start on `net` (worked hours); the owner can
 * switch to `gross` and back through the ordinary settings writer.
 */
describe("business.pay_rule_threshold_basis", () => {
  let businessId = "";
  let repo: TenantRepo;

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Threshold Café" })
      .returning();
    businessId = b!.id;
    repo = createTenantRepo(businessId);
  });

  afterAll(async () => {
    if (businessId)
      await db.delete(businesses).where(eq(businesses.id, businessId));
  });

  it("defaults a new business to worked hours (net)", async () => {
    expect((await repo.getBusiness())?.payRuleThresholdBasis).toBe("net");
  });

  it("the owner can switch to clock hours (gross) and back", async () => {
    await repo.updateBusinessSettings({ payRuleThresholdBasis: "gross" });
    expect((await repo.getBusiness())?.payRuleThresholdBasis).toBe("gross");
    await repo.updateBusinessSettings({ payRuleThresholdBasis: "net" });
    expect((await repo.getBusiness())?.payRuleThresholdBasis).toBe("net");
  });
});
