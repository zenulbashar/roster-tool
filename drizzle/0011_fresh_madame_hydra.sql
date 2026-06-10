CREATE TYPE "public"."staff_notification_type" AS ENUM('leave_decided', 'shift_swap_approved', 'rostered', 'shift_reminder');--> statement-breakpoint
CREATE TABLE "staff_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"type" "staff_notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "staff_shift_reminders_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "notices_token_hash" text;--> statement-breakpoint
ALTER TABLE "staff_notification" ADD CONSTRAINT "staff_notification_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notification" ADD CONSTRAINT "staff_notification_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_notification_staff_read_idx" ON "staff_notification" USING btree ("staff_member_id","is_read");--> statement-breakpoint
CREATE INDEX "staff_notification_business_created_idx" ON "staff_notification" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_notification_dedupe_key_idx" ON "staff_notification" USING btree ("dedupe_key");--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_notices_token_hash_unique" UNIQUE("notices_token_hash");