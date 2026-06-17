ALTER TYPE "public"."notification_type" ADD VALUE 'form_response';--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "notify_form_response" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_unread_group_unique" ON "notification" USING btree ("business_id","group_key") WHERE "notification"."group_key" is not null and "notification"."is_read" = false;