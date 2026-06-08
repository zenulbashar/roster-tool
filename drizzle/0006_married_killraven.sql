CREATE TYPE "public"."shift_offer_status" AS ENUM('open', 'claimed', 'approved', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TABLE "shift_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"offered_by_staff_id" uuid,
	"claimed_by_staff_id" uuid,
	"status" "shift_offer_status" DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_offer" ADD CONSTRAINT "shift_offer_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_offer" ADD CONSTRAINT "shift_offer_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_offer" ADD CONSTRAINT "shift_offer_offered_by_staff_id_staff_member_id_fk" FOREIGN KEY ("offered_by_staff_id") REFERENCES "public"."staff_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_offer" ADD CONSTRAINT "shift_offer_claimed_by_staff_id_staff_member_id_fk" FOREIGN KEY ("claimed_by_staff_id") REFERENCES "public"."staff_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_offer_business_idx" ON "shift_offer" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "shift_offer_shift_idx" ON "shift_offer" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_offer_status_idx" ON "shift_offer" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_offer_one_active_per_shift" ON "shift_offer" USING btree ("shift_id") WHERE "shift_offer"."status" in ('open', 'claimed');