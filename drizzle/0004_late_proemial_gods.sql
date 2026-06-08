CREATE TYPE "public"."rate_type" AS ENUM('flat', 'award');--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "geofence_radius_m" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "personal_clock_token_hash" text;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "pay_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "rate_type" "rate_type" DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "rate_label" text;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD COLUMN "clock_in_lat" double precision;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD COLUMN "clock_in_lng" double precision;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD COLUMN "within_geofence" boolean;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_personal_clock_token_hash_unique" UNIQUE("personal_clock_token_hash");