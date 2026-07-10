CREATE TYPE "public"."pay_rule_condition_type" AS ENUM('day_of_week', 'time_of_day_after', 'time_of_day_before', 'daily_hours_beyond', 'weekly_hours_beyond');--> statement-breakpoint
CREATE TABLE "pay_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"condition_type" "pay_rule_condition_type" NOT NULL,
	"condition_config" jsonb NOT NULL,
	"earnings_rate_id" text NOT NULL,
	"earnings_rate_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_rule" ADD CONSTRAINT "pay_rule_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_rule_business_idx" ON "pay_rule" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "pay_rule_business_priority_idx" ON "pay_rule" USING btree ("business_id","priority");