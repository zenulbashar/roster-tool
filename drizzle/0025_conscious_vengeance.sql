CREATE TABLE "staff_loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"from_business_id" uuid NOT NULL,
	"to_business_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_location" ADD COLUMN "loan_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_loan" ADD CONSTRAINT "staff_loan_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_loan" ADD CONSTRAINT "staff_loan_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_loan" ADD CONSTRAINT "staff_loan_from_business_id_business_id_fk" FOREIGN KEY ("from_business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_loan" ADD CONSTRAINT "staff_loan_to_business_id_business_id_fk" FOREIGN KEY ("to_business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_loan_org_idx" ON "staff_loan" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "staff_loan_staff_idx" ON "staff_loan" USING btree ("staff_member_id");--> statement-breakpoint
CREATE INDEX "staff_loan_to_business_idx" ON "staff_loan" USING btree ("to_business_id");--> statement-breakpoint
CREATE INDEX "staff_loan_active_idx" ON "staff_loan" USING btree ("active");--> statement-breakpoint
ALTER TABLE "staff_location" ADD CONSTRAINT "staff_location_loan_id_staff_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."staff_loan"("id") ON DELETE set null ON UPDATE no action;