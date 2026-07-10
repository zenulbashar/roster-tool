import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { payRules } from "@/lib/db/schema";
import { PAY_RULE_CONDITION_TYPES } from "@/lib/xero/pay-rules";

/**
 * BOUNDARY GUARDS for the pay-classification rules engine, mirroring the Xero
 * client's pinned method set. The commissioning requirements, verbatim:
 * "Roster ships with ZERO built-in award rules, ZERO default penalty
 * percentages, ZERO award names in code/config/UI. Rules table ships EMPTY
 * ... Roster stores NO dollar figure and NO multiplier." If any of these
 * tests fails, the change it caught is a boundary breach, not a refactor.
 */

const ROOT = join(__dirname, "..");

describe("pay_rule table boundary", () => {
  it("has EXACTLY the mapping columns — no rate/multiplier/percent/dollar column", () => {
    const columns = Object.values(getTableColumns(payRules)).map((c) => c.name);
    // The full pinned set. `earnings_rate_id`/`earnings_rate_name` are a
    // REFERENCE to the owner's Xero pay item + a display snapshot — the only
    // pay-related fields, and neither holds a number.
    expect(columns.sort()).toEqual(
      [
        "id",
        "business_id",
        "name",
        "priority",
        "is_active",
        "condition_type",
        "condition_config",
        "earnings_rate_id",
        "earnings_rate_name",
        "created_at",
        "updated_at",
      ].sort(),
    );
    // Belt and braces: nothing that could hold pay maths sneaks in later.
    for (const name of columns) {
      expect(name).not.toMatch(
        /multiplier|percent|amount|dollar|cents|pay_rate|loading/i,
      );
    }
  });

  it("the migration creating pay_rule INSERTs nothing (the table ships empty)", () => {
    const dir = join(ROOT, "drizzle");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    const creating = files.filter((f) =>
      readFileSync(join(dir, f), "utf8").includes('CREATE TABLE "pay_rule"'),
    );
    expect(creating).toHaveLength(1);
    const sql = readFileSync(join(dir, creating[0]!), "utf8");
    expect(sql.toUpperCase()).not.toContain("INSERT");
  });

  it("the seed script creates no pay rules (demo data ships none either)", () => {
    const seed = readFileSync(join(ROOT, "scripts", "seed.ts"), "utf8");
    expect(seed).not.toMatch(/payRules|pay_rule/);
  });
});

describe("rules engine vocabulary boundary", () => {
  const ENGINE_AND_UI_FILES = [
    "src/lib/xero/pay-rules.ts",
    "src/app/app/xero/rules/page.tsx",
    "src/app/app/xero/rules/rule-form.tsx",
    "src/app/app/xero/rules/actions.ts",
    "src/app/app/xero/push/page.tsx",
  ];

  it("contains no award names, award codes or built-in classification vocabulary", () => {
    for (const rel of ENGINE_AND_UI_FILES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      // Award identifiers (e.g. MA000009), the word award itself, and
      // built-in-percentage vocabulary must never appear in the engine or its
      // UI — the owner names their rules; Roster suggests nothing.
      expect(src, rel).not.toMatch(/MA0\d{3}/i);
      expect(src, rel).not.toMatch(/\baward\b/i);
      expect(src, rel).not.toMatch(/\bpenalty\b/i);
      expect(src, rel).not.toMatch(/\bcasual loading\b/i);
      expect(src, rel).not.toMatch(/\b(?:time and a half|double time)\b/i);
      expect(src, rel).not.toMatch(/\b\d+(?:\.\d+)?\s*%/);
    }
  });

  it("exposes exactly the five mechanical condition types", () => {
    expect([...PAY_RULE_CONDITION_TYPES].sort()).toEqual(
      [
        "daily_hours_beyond",
        "day_of_week",
        "time_of_day_after",
        "time_of_day_before",
        "weekly_hours_beyond",
      ].sort(),
    );
  });

  it("ships zero built-in rules: no default/preset rule definitions in the engine", () => {
    const src = readFileSync(join(ROOT, "src/lib/xero/pay-rules.ts"), "utf8");
    // The engine defines types and evaluation only — no rule INSTANCES. Any
    // "starter"/"default"/"preset" rule list would need a literal with an
    // earningsRateId value, which the module must not contain.
    expect(src).not.toMatch(/DEFAULT_RULES|PRESET|STARTER/i);
    expect(src).not.toMatch(/earningsRateId:\s*["']/);
  });
});
