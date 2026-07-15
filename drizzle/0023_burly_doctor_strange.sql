CREATE TYPE "public"."org_role" AS ENUM('owner');--> statement-breakpoint
CREATE TABLE "org_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "org_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_membership_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_location_business_staff_unique" UNIQUE("business_id","staff_member_id")
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "org_membership" ADD CONSTRAINT "org_membership_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_membership" ADD CONSTRAINT "org_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_location" ADD CONSTRAINT "staff_location_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_location" ADD CONSTRAINT "staff_location_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_location" ADD CONSTRAINT "staff_location_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_membership_user_idx" ON "org_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_membership_org_idx" ON "org_membership" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "staff_location_business_idx" ON "staff_location" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_location_staff_idx" ON "staff_location" USING btree ("staff_member_id");--> statement-breakpoint
CREATE INDEX "staff_location_org_idx" ON "staff_location" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_member_org_idx" ON "staff_member" USING btree ("org_id");--> statement-breakpoint
-- ==========================================================================
-- M29 backfill (idempotent) — give every pre-existing single-location owner an
-- organisation so the app can treat org_id as populated. One org per business,
-- reusing the business id as the org id for a trivially linkable, re-runnable
-- 1:1 mapping. Safe to re-apply: every step is guarded by IS NULL / ON CONFLICT.
-- Mirrored (and unit-tested) as backfillOrgs() in src/lib/tenant/org-backfill.ts
-- — keep the two in sync. See docs/multi-location-plan.md §9.
-- ==========================================================================
-- 1. One organisation per existing business (id reused → linkable & idempotent).
INSERT INTO "organisation" ("id", "name", "default_timezone")
SELECT "id", "name", "timezone" FROM "business"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- 2. Point each business at its organisation.
UPDATE "business" SET "org_id" = "id" WHERE "org_id" IS NULL;--> statement-breakpoint
-- 3. Point each staff member at its home business's organisation.
UPDATE "staff_member" AS sm SET "org_id" = b."org_id"
FROM "business" b WHERE sm."business_id" = b."id" AND sm."org_id" IS NULL;--> statement-breakpoint
-- 4. Make each onboarded owner a member (role 'owner') of their business's org.
INSERT INTO "org_membership" ("org_id", "user_id", "role")
SELECT b."org_id", u."id", 'owner'
FROM "user" u JOIN "business" b ON u."businessId" = b."id"
WHERE b."org_id" IS NOT NULL
ON CONFLICT ("org_id", "user_id") DO NOTHING;--> statement-breakpoint
-- 5. One staff_location membership per existing staff member at its home location.
INSERT INTO "staff_location" ("org_id", "business_id", "staff_member_id", "active")
SELECT sm."org_id", sm."business_id", sm."id", sm."active"
FROM "staff_member" sm
WHERE sm."org_id" IS NOT NULL
ON CONFLICT ("business_id", "staff_member_id") DO NOTHING;