-- PERF-02 / PERF-03: the daily sweeps fan out per business at each location's
-- OWN local send hour. `business.digest_hour_local` (owner digests: certs,
-- orders, form responses) and `business.reminder_hour_local` (the staff "you
-- work tomorrow" notice) default to the hours the old fixed-UTC crons meant
-- for a Sydney venue, so nothing changes for existing tenants on deploy.
-- `job_dispatch` is the hourly dispatcher's exactly-once ledger: one row per
-- (sweep kind, business, local run date).
CREATE TABLE "job_dispatch" (
	"kind" text NOT NULL,
	"business_id" uuid NOT NULL,
	"run_date" date NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_dispatch_kind_business_id_run_date_pk" PRIMARY KEY("kind","business_id","run_date")
);
--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "digest_hour_local" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "reminder_hour_local" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_dispatch" ADD CONSTRAINT "job_dispatch_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_dispatch_enqueued_idx" ON "job_dispatch" USING btree ("enqueued_at");
