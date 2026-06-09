CREATE TYPE "public"."notification_type" AS ENUM('leave_requested', 'shift_offer_activity', 'stock_needs_order', 'cert_expiring', 'availability_reply');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "notify_leave_requested" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "notify_shift_offer_activity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "notify_stock_needs_order" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "notify_cert_expiring" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "notify_availability_reply" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_business_read_idx" ON "notification" USING btree ("business_id","is_read");--> statement-breakpoint
CREATE INDEX "notification_business_created_idx" ON "notification" USING btree ("business_id","created_at");