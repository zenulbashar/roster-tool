ALTER TABLE "roster_assignment" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD COLUMN "end_time" time;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD COLUMN "break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_assignment" ADD COLUMN "break_start" time;