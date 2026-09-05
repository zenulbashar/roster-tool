-- PERF-01 index pack (audit 2026-07). Every statement is IF NOT EXISTS so an
-- operator may pre-build any of these on a large production table with
-- CREATE INDEX CONCURRENTLY (outside this transactional migration) and this
-- file then becomes a no-op for it. On the tables' current sizes a plain
-- CREATE INDEX holds its SHARE lock for well under a second. The one DROP is
-- of a near-useless plain index on a boolean, replaced by a partial index;
-- no data is touched.
DROP INDEX IF EXISTS "staff_loan_active_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_activity_business_idx" ON "admin_activity" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "availability_response_business_shift_idx" ON "availability_response" USING btree ("business_id","shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clock_photo_entry_idx" ON "clock_photo" USING btree ("timesheet_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clock_photo_business_idx" ON "clock_photo" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_rate_limit_expires_idx" ON "form_rate_limit" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "published_roster_business_idx" ON "published_roster" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roster_assignment_business_idx" ON "roster_assignment" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roster_assignment_staff_idx" ON "roster_assignment" USING btree ("staff_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roster_period_business_idx" ON "roster_period" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_template_business_idx" ON "shift_template" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_business_date_idx" ON "shift" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_loan_active_partial_idx" ON "staff_loan" USING btree ("to_business_id","staff_member_id") WHERE "staff_loan"."active" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timesheet_entry_business_clockin_idx" ON "timesheet_entry" USING btree ("business_id","clock_in_at");