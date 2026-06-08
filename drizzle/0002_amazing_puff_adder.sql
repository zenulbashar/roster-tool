CREATE TYPE "public"."clock_photo_kind" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE "clock_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"timesheet_entry_id" uuid NOT NULL,
	"kind" "clock_photo_kind" NOT NULL,
	"mime_type" text NOT NULL,
	"image_data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"shift_id" uuid,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "require_clock_in_photo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "kiosk_token_hash" text;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "failed_pin_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "pin_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clock_photo" ADD CONSTRAINT "clock_photo_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clock_photo" ADD CONSTRAINT "clock_photo_timesheet_entry_id_timesheet_entry_id_fk" FOREIGN KEY ("timesheet_entry_id") REFERENCES "public"."timesheet_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timesheet_entry_business_staff_idx" ON "timesheet_entry" USING btree ("business_id","staff_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_entry_one_open_per_staff" ON "timesheet_entry" USING btree ("staff_member_id") WHERE "timesheet_entry"."clock_out_at" is null;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_kiosk_token_hash_unique" UNIQUE("kiosk_token_hash");