CREATE TYPE "public"."assignment_status" AS ENUM('suggested', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."availability_source" AS ENUM('staff', 'manual');--> statement-breakpoint
ALTER TABLE "availability_response" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_response" ADD COLUMN "staff_member_id" uuid;--> statement-breakpoint
ALTER TABLE "availability_response" ADD COLUMN "source" "availability_source" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD COLUMN "status" "assignment_status" DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_member" ADD COLUMN "notify_by_default" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_response" ADD CONSTRAINT "availability_response_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_response_manual_staff_shift_unique" ON "availability_response" USING btree ("staff_member_id","shift_id") WHERE "availability_response"."request_id" is null;