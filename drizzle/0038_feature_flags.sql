-- OPS-05: feature flags. The registry of flags + code defaults lives in
-- src/lib/flags/registry.ts; these two vendor tables hold only DEVIATIONS —
-- a global setting for everyone, or an override for one organisation (which
-- wins). Set from the Zale IT admin console (/admin/flags); read by
-- isFeatureEnabled(). Non-tenant infrastructure tables (no business_id).
CREATE TABLE "feature_flag_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_key" text NOT NULL,
	"org_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_flag_override" ADD CONSTRAINT "feature_flag_override_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flag_override_key_org_unique" ON "feature_flag_override" USING btree ("flag_key","org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_flag_override_org_idx" ON "feature_flag_override" USING btree ("org_id");
