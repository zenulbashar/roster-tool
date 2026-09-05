-- COR-08: what a pay rule's daily/weekly hours threshold counts. New
-- businesses default to `net` (worked hours, unpaid breaks left out). Any
-- business that ALREADY has pay rules keeps the behaviour it had (`gross`,
-- clock hours) so nobody's split changes silently — the owner switches on
-- /app/xero/rules, where the choice is spelled out.
CREATE TYPE "public"."pay_rule_threshold_basis" AS ENUM('net', 'gross');--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "pay_rule_threshold_basis" "pay_rule_threshold_basis" DEFAULT 'net' NOT NULL;--> statement-breakpoint
UPDATE "business" SET "pay_rule_threshold_basis" = 'gross' WHERE "id" IN (SELECT DISTINCT "business_id" FROM "pay_rule");
