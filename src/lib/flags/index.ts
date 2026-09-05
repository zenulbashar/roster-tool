import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  featureFlags,
  featureFlagOverrides,
  organisations,
} from "@/lib/db/schema";
import {
  FLAGS,
  FLAG_KEYS,
  evaluateFlag,
  flagSource,
  isFlagKey,
  type FlagKey,
  type FlagSource,
  type FlagState,
} from "./registry";

export {
  FLAGS,
  FLAG_KEYS,
  evaluateFlag,
  flagSource,
  isFlagKey,
  type FlagKey,
  type FlagSource,
  type FlagState,
} from "./registry";

/**
 * Feature-flag accessor (OPS-05).
 *
 * `isFeatureEnabled(key, { orgId })` is the ONE way code asks whether a flag is
 * on. It is typed on the registry (an unknown key is a build error), resolves
 * org override → global → code default, and is MEMOISED PER REQUEST with
 * `React.cache` (PERF-04 pattern): the first check in a request loads every
 * global row in one query and the org's overrides in one more, so a page that
 * asks about five flags costs two queries, not ten. Outside a React request
 * (jobs, scripts, tests) the loaders simply run.
 *
 * FAIL SAFE, NOT CLOSED: a flag guards a code path, never access, so if the
 * lookup itself fails the code default answers (logged by the caller's error
 * path — a flags outage must not take the product down). Access decisions
 * never go through flags.
 */

const loadGlobalFlags = cache(async (): Promise<Map<string, boolean>> => {
  const rows = await db
    .select({ key: featureFlags.key, enabled: featureFlags.enabled })
    .from(featureFlags);
  return new Map(rows.map((r) => [r.key, r.enabled]));
});

const loadOrgOverrides = cache(
  async (orgId: string): Promise<Map<string, boolean>> => {
    const rows = await db
      .select({
        key: featureFlagOverrides.flagKey,
        enabled: featureFlagOverrides.enabled,
      })
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.orgId, orgId));
    return new Map(rows.map((r) => [r.key, r.enabled]));
  },
);

async function stateFor(
  key: FlagKey,
  orgId: string | null | undefined,
): Promise<FlagState> {
  const globals = await loadGlobalFlags();
  const overrides = orgId ? await loadOrgOverrides(orgId) : null;
  return {
    global: globals.has(key) ? (globals.get(key) as boolean) : null,
    override: overrides?.has(key) ? (overrides.get(key) as boolean) : null,
  };
}

/**
 * Is `key` on for this scope? Pass the acting owner's `orgId` (from
 * `requireOwner()` — never request input) so a per-client override applies;
 * omit it for org-less contexts (sign-up, the worker's global sweeps), where
 * only the global setting and the code default can answer.
 */
export async function isFeatureEnabled(
  key: FlagKey,
  scope?: { orgId?: string | null },
): Promise<boolean> {
  return evaluateFlag(key, await stateFor(key, scope?.orgId));
}

/* ----- Admin console (vendor writes; callers sit behind requireAdmin()) ----- */

export interface FlagOverrideRow {
  orgId: string;
  orgName: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface FlagStatusRow {
  key: FlagKey;
  description: string;
  defaultEnabled: boolean;
  /** The global row, or null when the code default is in force. */
  global: {
    enabled: boolean;
    updatedBy: string | null;
    updatedAt: Date;
  } | null;
  /** What everyone without an override currently gets. */
  effective: boolean;
  source: Exclude<FlagSource, "override">;
  overrides: FlagOverrideRow[];
}

/** Every registered flag with its stored state — the admin console's view. */
export async function listFlagStatuses(): Promise<FlagStatusRow[]> {
  const globals = await db.select().from(featureFlags);
  const globalByKey = new Map(globals.map((g) => [g.key, g]));
  const overrides = await db
    .select({
      flagKey: featureFlagOverrides.flagKey,
      orgId: featureFlagOverrides.orgId,
      orgName: organisations.name,
      enabled: featureFlagOverrides.enabled,
      updatedBy: featureFlagOverrides.updatedBy,
      updatedAt: featureFlagOverrides.updatedAt,
    })
    .from(featureFlagOverrides)
    .innerJoin(organisations, eq(organisations.id, featureFlagOverrides.orgId))
    .where(inArray(featureFlagOverrides.flagKey, FLAG_KEYS))
    .orderBy(organisations.name);
  const overridesByKey = new Map<string, FlagOverrideRow[]>();
  for (const o of overrides) {
    const list = overridesByKey.get(o.flagKey) ?? [];
    list.push({
      orgId: o.orgId,
      orgName: o.orgName,
      enabled: o.enabled,
      updatedBy: o.updatedBy,
      updatedAt: o.updatedAt,
    });
    overridesByKey.set(o.flagKey, list);
  }

  return FLAG_KEYS.map((key) => {
    const g = globalByKey.get(key) ?? null;
    const state: FlagState = { global: g?.enabled ?? null, override: null };
    return {
      key,
      description: FLAGS[key].description,
      defaultEnabled: FLAGS[key].defaultEnabled,
      global: g
        ? { enabled: g.enabled, updatedBy: g.updatedBy, updatedAt: g.updatedAt }
        : null,
      effective: evaluateFlag(key, state),
      source: flagSource(state) as Exclude<FlagSource, "override">,
      overrides: overridesByKey.get(key) ?? [],
    };
  });
}

/**
 * Set a flag for everyone (`enabled` true/false), or `null` to remove the
 * global row so the code default answers again. Idempotent upsert.
 */
export async function setGlobalFlag(
  key: FlagKey,
  enabled: boolean | null,
  actor: string,
): Promise<void> {
  if (!isFlagKey(key)) throw new Error(`Unknown feature flag: ${key}`);
  if (enabled === null) {
    await db.delete(featureFlags).where(eq(featureFlags.key, key));
    return;
  }
  await db
    .insert(featureFlags)
    .values({ key, enabled, updatedBy: actor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: { enabled, updatedBy: actor, updatedAt: new Date() },
    });
}

/**
 * Set a flag for ONE organisation (wins over the global value). Refuses an
 * unknown org rather than creating a dangling override. Idempotent upsert.
 */
export async function setOrgFlagOverride(
  key: FlagKey,
  orgId: string,
  enabled: boolean,
  actor: string,
): Promise<
  { ok: true; orgName: string } | { ok: false; reason: "unknown_org" }
> {
  if (!isFlagKey(key)) throw new Error(`Unknown feature flag: ${key}`);
  const [org] = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  if (!org) return { ok: false, reason: "unknown_org" };
  await db
    .insert(featureFlagOverrides)
    .values({
      flagKey: key,
      orgId,
      enabled,
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [featureFlagOverrides.flagKey, featureFlagOverrides.orgId],
      set: { enabled, updatedBy: actor, updatedAt: new Date() },
    });
  return { ok: true, orgName: org.name };
}

/**
 * Remove an org's override so the global value / code default applies.
 * Returns the org's name (for the audit row), or null when it doesn't exist.
 */
export async function clearOrgFlagOverride(
  key: FlagKey,
  orgId: string,
): Promise<{ orgName: string | null }> {
  const [org] = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);
  await db
    .delete(featureFlagOverrides)
    .where(
      and(
        eq(featureFlagOverrides.flagKey, key),
        eq(featureFlagOverrides.orgId, orgId),
      ),
    );
  return { orgName: org?.name ?? null };
}
