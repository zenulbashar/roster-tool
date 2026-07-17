ALTER TABLE "business" ADD COLUMN "form_digest_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "form_digest_last_at" timestamp with time zone;