CREATE TYPE "public"."shift_offer_scope" AS ENUM('location', 'org');--> statement-breakpoint
ALTER TABLE "shift_offer" ADD COLUMN "scope" "shift_offer_scope" DEFAULT 'location' NOT NULL;