CREATE TYPE "public"."stock_check_status" AS ENUM('available', 'low', 'needs_order');--> statement-breakpoint
CREATE TABLE "stock_check_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"status" "stock_check_status" NOT NULL,
	"quantity" text,
	"checked_by_staff_id" uuid,
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "last_order_reminder_date" date;--> statement-breakpoint
ALTER TABLE "stock_check_entry" ADD CONSTRAINT "stock_check_entry_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_check_entry" ADD CONSTRAINT "stock_check_entry_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_check_entry" ADD CONSTRAINT "stock_check_entry_checked_by_staff_id_staff_member_id_fk" FOREIGN KEY ("checked_by_staff_id") REFERENCES "public"."staff_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_check_entry_business_item_idx" ON "stock_check_entry" USING btree ("business_id","item_id");--> statement-breakpoint
CREATE INDEX "stock_check_entry_business_checked_idx" ON "stock_check_entry" USING btree ("business_id","checked_at");