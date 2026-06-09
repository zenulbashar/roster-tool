CREATE TYPE "public"."cert_reminder_stage" AS ENUM('early', 'final', 'expired');--> statement-breakpoint
CREATE TYPE "public"."cert_type" AS ENUM('rsa', 'rsg', 'food_safety', 'first_aid', 'wwcc', 'other');--> statement-breakpoint
CREATE TABLE "staff_certification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"cert_type" "cert_type" NOT NULL,
	"cert_label" text,
	"reference_number" text,
	"expiry_date" date NOT NULL,
	"last_reminder_stage" "cert_reminder_stage",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "cert_reminder_lead_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_certification" ADD CONSTRAINT "staff_certification_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certification" ADD CONSTRAINT "staff_certification_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_certification_business_idx" ON "staff_certification" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_certification_staff_idx" ON "staff_certification" USING btree ("staff_member_id");--> statement-breakpoint
CREATE INDEX "staff_certification_expiry_idx" ON "staff_certification" USING btree ("expiry_date");