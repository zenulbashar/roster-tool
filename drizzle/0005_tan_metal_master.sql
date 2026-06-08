CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'unpaid', 'other');--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_request_business_idx" ON "leave_request" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "leave_request_staff_idx" ON "leave_request" USING btree ("staff_member_id");--> statement-breakpoint
CREATE INDEX "leave_request_status_idx" ON "leave_request" USING btree ("status");