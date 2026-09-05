import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  organisations,
  featureFlags,
  featureFlagOverrides,
} from "@/lib/db/schema";
import {
  isFeatureEnabled,
  listFlagStatuses,
  setGlobalFlag,
  setOrgFlagOverride,
  clearOrgFlagOverride,
  FLAGS,
} from "@/lib/flags";

/**
 * OPS-05 — feature flags end to end against Postgres: the code default, a
 * global setting, a per-org override that wins (and only for that org), and
 * the admin console's status view. `audit_events` is used because it has no
 * consumer yet, so flipping it globally can't disturb a concurrently running
 * test file; every case restores the state it touched.
 */
describe("feature flags (flow)", () => {
  const KEY = "audit_events" as const;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(organisations)
      .values({ name: "Flags Org A" })
      .returning();
    const [b] = await db
      .insert(organisations)
      .values({ name: "Flags Org B" })
      .returning();
    orgA = a!.id;
    orgB = b!.id;
    await db.delete(featureFlags).where(eq(featureFlags.key, KEY));
  });

  afterAll(async () => {
    await db.delete(featureFlags).where(eq(featureFlags.key, KEY));
    await db
      .delete(featureFlagOverrides)
      .where(inArray(featureFlagOverrides.orgId, [orgA, orgB]));
    for (const id of [orgA, orgB]) {
      if (id) await db.delete(organisations).where(eq(organisations.id, id));
    }
    await db.$client.end();
  });

  it("answers with the code default when nothing is stored", async () => {
    expect(await isFeatureEnabled(KEY)).toBe(FLAGS[KEY].defaultEnabled);
    expect(await isFeatureEnabled(KEY, { orgId: orgA })).toBe(
      FLAGS[KEY].defaultEnabled,
    );
    expect(await isFeatureEnabled("owner_signups")).toBe(true);
  });

  it("a global setting applies to every scope, and removing it restores the default", async () => {
    await setGlobalFlag(KEY, true, "Priya");
    expect(await isFeatureEnabled(KEY)).toBe(true);
    expect(await isFeatureEnabled(KEY, { orgId: orgA })).toBe(true);
    expect(await isFeatureEnabled(KEY, { orgId: orgB })).toBe(true);

    // Idempotent upsert: setting it again just updates the row.
    await setGlobalFlag(KEY, true, "Priya again");
    const rows = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedBy).toBe("Priya again");

    await setGlobalFlag(KEY, null, "Priya");
    expect(await isFeatureEnabled(KEY)).toBe(FLAGS[KEY].defaultEnabled);
  });

  it("an org override wins for that org only, and clears cleanly", async () => {
    await setGlobalFlag(KEY, false, "Priya");
    const set = await setOrgFlagOverride(KEY, orgB, true, "Priya");
    expect(set).toEqual({ ok: true, orgName: "Flags Org B" });

    expect(await isFeatureEnabled(KEY, { orgId: orgB })).toBe(true);
    expect(await isFeatureEnabled(KEY, { orgId: orgA })).toBe(false);
    expect(await isFeatureEnabled(KEY)).toBe(false); // no org → global

    // The override can also switch a flag OFF for one client while everyone
    // else has it on (the per-client kill switch).
    await setGlobalFlag(KEY, true, "Priya");
    await setOrgFlagOverride(KEY, orgB, false, "Priya");
    expect(await isFeatureEnabled(KEY, { orgId: orgB })).toBe(false);
    expect(await isFeatureEnabled(KEY, { orgId: orgA })).toBe(true);

    const cleared = await clearOrgFlagOverride(KEY, orgB);
    expect(cleared.orgName).toBe("Flags Org B");
    expect(await isFeatureEnabled(KEY, { orgId: orgB })).toBe(true);
    await setGlobalFlag(KEY, null, "Priya");
  });

  it("refuses an override for an organisation that doesn't exist", async () => {
    const res = await setOrgFlagOverride(
      KEY,
      "00000000-0000-0000-0000-000000000000",
      true,
      "Priya",
    );
    expect(res).toEqual({ ok: false, reason: "unknown_org" });
  });

  it("lists every registered flag with its effective value, source and overrides", async () => {
    await setOrgFlagOverride(KEY, orgA, true, "Priya");
    const statuses = await listFlagStatuses();
    expect(statuses.map((s) => s.key)).toEqual(Object.keys(FLAGS));

    const audit = statuses.find((s) => s.key === KEY)!;
    expect(audit.source).toBe("default");
    expect(audit.effective).toBe(FLAGS[KEY].defaultEnabled);
    expect(audit.global).toBeNull();
    const ov = audit.overrides.find((o) => o.orgId === orgA)!;
    expect(ov).toMatchObject({
      orgName: "Flags Org A",
      enabled: true,
      updatedBy: "Priya",
    });

    await setGlobalFlag(KEY, true, "Priya");
    const after = (await listFlagStatuses()).find((s) => s.key === KEY)!;
    expect(after.source).toBe("global");
    expect(after.effective).toBe(true);
    expect(after.global?.updatedBy).toBe("Priya");

    await setGlobalFlag(KEY, null, "Priya");
    await clearOrgFlagOverride(KEY, orgA);
  });

  it("deleting an organisation removes its overrides (cascade)", async () => {
    const [tmp] = await db
      .insert(organisations)
      .values({ name: "Flags Org Temp" })
      .returning();
    await setOrgFlagOverride(KEY, tmp!.id, true, "Priya");
    await db.delete(organisations).where(eq(organisations.id, tmp!.id));
    const rows = await db
      .select()
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.orgId, tmp!.id));
    expect(rows).toHaveLength(0);
  });
});
