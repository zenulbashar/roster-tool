import { describe, it, expect } from "vitest";
import {
  FLAGS,
  FLAG_KEYS,
  evaluateFlag,
  flagSource,
  isFlagKey,
  type FlagKey,
} from "@/lib/flags/registry";

/**
 * OPS-05 — the pure flag registry + resolver. The database only ever holds
 * deviations; this pins the precedence (org override → global → code default)
 * and that the registry is well-formed, so a flag can never resolve to
 * "nothing" and a typo can never resolve to "off".
 */
describe("feature-flag registry (pure)", () => {
  it("declares every flag with a description and a boolean default", () => {
    expect(FLAG_KEYS.length).toBeGreaterThan(0);
    for (const key of FLAG_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(FLAGS[key].description.trim().length).toBeGreaterThan(10);
      expect(typeof FLAGS[key].defaultEnabled).toBe("boolean");
    }
  });

  it("recognises registered keys and rejects unknown ones", () => {
    expect(isFlagKey("owner_signups")).toBe(true);
    expect(isFlagKey("not_a_flag")).toBe(false);
    expect(isFlagKey("toString")).toBe(false); // prototype keys never count
    expect(() =>
      evaluateFlag("not_a_flag" as FlagKey, { global: null, override: null }),
    ).toThrow(/Unknown feature flag/);
  });

  it("falls back to the code default when nothing is stored", () => {
    expect(
      evaluateFlag("owner_signups", { global: null, override: null }),
    ).toBe(FLAGS.owner_signups.defaultEnabled);
    expect(evaluateFlag("audit_events", { global: null, override: null })).toBe(
      FLAGS.audit_events.defaultEnabled,
    );
  });

  it("a global setting beats the code default, both ways", () => {
    expect(
      evaluateFlag("owner_signups", { global: false, override: null }),
    ).toBe(false);
    expect(evaluateFlag("audit_events", { global: true, override: null })).toBe(
      true,
    );
  });

  it("an org override beats the global setting, both ways", () => {
    expect(
      evaluateFlag("audit_events", { global: true, override: false }),
    ).toBe(false);
    expect(
      evaluateFlag("audit_events", { global: false, override: true }),
    ).toBe(true);
    // ...and beats the default when there is no global row.
    expect(
      evaluateFlag("owner_signups", { global: null, override: false }),
    ).toBe(false);
  });

  it("names where a value came from", () => {
    expect(flagSource({ global: null, override: null })).toBe("default");
    expect(flagSource({ global: true, override: null })).toBe("global");
    expect(flagSource({ global: true, override: false })).toBe("override");
  });
});
