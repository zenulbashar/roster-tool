import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  businesses,
  organisations,
  orgMemberships,
  users,
} from "@/lib/db/schema";

/**
 * The canonical multi-location fixture (TEST-02).
 *
 * Builds a tenant the way the APPLICATION does: one organisation, an owner
 * reachable through `org_membership` (never by writing the legacy
 * `users.business_id` pointer — production only ever sets that at onboarding,
 * for the FIRST location), and two locations under the org. Any test that
 * touches per-business behaviour in a multi-location world should start here,
 * so a fixture can never encode an assumption the app doesn't honour.
 */
export type TwoLocationOrg = {
  orgId: string;
  ownerUserId: string;
  ownerEmail: string;
  /** The owner's home location. */
  bizA: string;
  /** A location added later (the one COR-01 silently skipped). */
  bizB: string;
  cleanup: () => Promise<void>;
};

export async function makeOrgWithTwoLocations(opts: {
  /** Unique per test file so parallel workers can't collide on emails. */
  prefix: string;
  timezone?: string;
}): Promise<TwoLocationOrg> {
  const timezone = opts.timezone ?? "UTC";
  const ownerEmail = `${opts.prefix}-owner@multi.test`;

  const [org] = await db
    .insert(organisations)
    .values({ name: `${opts.prefix} Org`, defaultTimezone: timezone })
    .returning();
  const [a] = await db
    .insert(businesses)
    .values({ name: `${opts.prefix} Loc A`, timezone, orgId: org!.id })
    .returning();
  const [b] = await db
    .insert(businesses)
    .values({ name: `${opts.prefix} Loc B`, timezone, orgId: org!.id })
    .returning();
  // Mirror onboarding: the owner's home pointer is their FIRST location only.
  const [owner] = await db
    .insert(users)
    .values({ email: ownerEmail, businessId: a!.id })
    .returning();
  await db
    .insert(orgMemberships)
    .values({ orgId: org!.id, userId: owner!.id, role: "owner" });

  return {
    orgId: org!.id,
    ownerUserId: owner!.id,
    ownerEmail,
    bizA: a!.id,
    bizB: b!.id,
    async cleanup() {
      // Org cascade removes both locations and the membership; the user row
      // is ours too.
      await db.delete(organisations).where(eq(organisations.id, org!.id));
      await db.delete(users).where(eq(users.id, owner!.id));
    },
  };
}

/**
 * Give an EXISTING business an owner the way the application does — through
 * an organisation + `org_membership`, never by writing the legacy
 * `users.business_id` pointer (TEST-02). Creates an org for the business when
 * it has none (a bare `insert(businesses)` fixture), so a job/handler test
 * exercises the org-based recipient resolution production actually uses.
 */
export async function attachOwner(
  businessId: string,
  email: string,
): Promise<{ userId: string; orgId: string }> {
  const [biz] = await db
    .select({ orgId: businesses.orgId })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  let orgId = biz?.orgId ?? null;
  if (!orgId) {
    const [org] = await db
      .insert(organisations)
      .values({ name: `Org for ${businessId.slice(0, 8)}` })
      .returning();
    orgId = org!.id;
    await db
      .update(businesses)
      .set({ orgId })
      .where(eq(businesses.id, businessId));
  }
  const [user] = await db.insert(users).values({ email }).returning();
  await db
    .insert(orgMemberships)
    .values({ orgId, userId: user!.id, role: "owner" });
  return { userId: user!.id, orgId };
}
