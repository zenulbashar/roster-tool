CREATE TYPE "public"."xero_connection_status" AS ENUM('pending_confirmation', 'active');--> statement-breakpoint
CREATE TYPE "public"."xero_push_status" AS ENUM('draft', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "xero_connect_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"sent_to_email" text NOT NULL,
	"created_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_ip" text,
	"consumed_user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xero_connect_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "xero_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"xero_tenant_id" text NOT NULL,
	"org_name" text NOT NULL,
	"connected_account_email" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"token_expiry" timestamp with time zone NOT NULL,
	"authorised_scopes" text,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"status" "xero_connection_status" DEFAULT 'pending_confirmation' NOT NULL,
	"connected_via_invite_id" uuid,
	"connected_ip" text,
	"connected_user_agent" text,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xero_connection_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "xero_employee_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"xero_employee_id" text NOT NULL,
	"xero_employee_name" text NOT NULL,
	"earnings_rate_id" text,
	"payroll_calendar_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xero_employee_map_business_staff_unique" UNIQUE("business_id","staff_member_id")
);
--> statement-breakpoint
CREATE TABLE "xero_timesheet_push" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"staff_member_id" uuid NOT NULL,
	"xero_employee_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"xero_timesheet_id" text,
	"status" "xero_push_status" DEFAULT 'draft' NOT NULL,
	"hours_total" double precision NOT NULL,
	"payload_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero_connect_invite" ADD CONSTRAINT "xero_connect_invite_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_connect_invite" ADD CONSTRAINT "xero_connect_invite_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_connection" ADD CONSTRAINT "xero_connection_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_connection" ADD CONSTRAINT "xero_connection_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_employee_map" ADD CONSTRAINT "xero_employee_map_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_employee_map" ADD CONSTRAINT "xero_employee_map_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_timesheet_push" ADD CONSTRAINT "xero_timesheet_push_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_timesheet_push" ADD CONSTRAINT "xero_timesheet_push_staff_member_id_staff_member_id_fk" FOREIGN KEY ("staff_member_id") REFERENCES "public"."staff_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xero_connect_invite_business_idx" ON "xero_connect_invite" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "xero_connection_business_idx" ON "xero_connection" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "xero_employee_map_business_idx" ON "xero_employee_map" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "xero_timesheet_push_period_unique" ON "xero_timesheet_push" USING btree ("business_id","staff_member_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "xero_timesheet_push_business_idx" ON "xero_timesheet_push" USING btree ("business_id");