/**
 * Feature-flag registry (OPS-05) — PURE, no I/O.
 *
 * Every flag the code can ask about is declared HERE, with a description and
 * its code default. The database holds only DEVIATIONS from the code: a
 * `feature_flag` row when Zale IT has set the flag for everyone, and a
 * `feature_flag_override` row when it has been set for one organisation. A key
 * that isn't declared here does not exist — the accessor is typed on
 * `FlagKey`, so a typo fails the build rather than silently reading "off".
 *
 * Resolution order (`evaluateFlag`): the org's override → the global row → the
 * code default. That gives the three operations a flag exists for:
 *   - dark-launch: default OFF, switch ON for one client to trial it;
 *   - canary → GA: switch ON for everyone once the trial holds, then flip the
 *     code default and delete the rows;
 *   - kill switch: switch OFF for everyone (or for the one client it hurts)
 *     without a deploy or a revert.
 *
 * Flags are for ROLLOUT CONTROL of code paths, never for per-client product
 * configuration — that stays on `business` (e.g. `require_clock_in_photo`).
 * A flag whose consumer has shipped and settled should be retired: flip the
 * default, remove the reads, delete the key.
 */

export interface FlagDefinition {
  /** One line for the admin console: what turning it ON does, and who it hits. */
  readonly description: string;
  /** What the code assumes when the database has no row for this flag. */
  readonly defaultEnabled: boolean;
}

export const FLAGS = {
  /**
   * New owners can create a business on /onboarding. OFF pauses sign-ups
   * (e.g. during an incident or a migration) with a clear message; existing
   * owners and every staff surface are unaffected. Global only in practice —
   * a sign-up has no organisation yet, so an org override never applies.
   */
  owner_signups: {
    description:
      'New owners can create a business on the onboarding page. Off shows a "sign-ups are paused" message; existing owners are unaffected.',
    defaultEnabled: true,
  },
  /**
   * Record the tenant-facing audit trail (`audit_event`) for every repository
   * write made through an owner context (milestone 1.8). ON by default — the
   * trail is additive and never changes behaviour — and this is its KILL
   * SWITCH (everyone, or one client) should the extra insert per write ever
   * need to be paused.
   */
  audit_events: {
    description:
      "Record every owner/admin write in the tenant audit trail (audit_event). Off pauses recording; nothing else changes.",
    defaultEnabled: true,
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;

export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export function isFlagKey(value: string): value is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAGS, value);
}

/** The stored state that may exist for a flag, as read from the database. */
export interface FlagState {
  /** The global row's value, or null when Zale IT has never set it. */
  global: boolean | null;
  /** The acting org's override, or null when none exists (or no org). */
  override: boolean | null;
}

/**
 * Resolve one flag: org override → global setting → code default. Pure and
 * total — every combination yields a boolean, and an unknown key throws (a
 * programming error, never a runtime "off").
 */
export function evaluateFlag(key: FlagKey, state: FlagState): boolean {
  const def = FLAGS[key] as FlagDefinition | undefined;
  if (!def) throw new Error(`Unknown feature flag: ${key}`);
  if (state.override !== null) return state.override;
  if (state.global !== null) return state.global;
  return def.defaultEnabled;
}

/**
 * Where a resolved value came from — shown in the admin console so an operator
 * can tell "on because of the code default" from "on because someone set it".
 */
export type FlagSource = "override" | "global" | "default";

export function flagSource(state: FlagState): FlagSource {
  if (state.override !== null) return "override";
  if (state.global !== null) return "global";
  return "default";
}
