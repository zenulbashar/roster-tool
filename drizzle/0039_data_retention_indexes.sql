-- PERF-10: the daily data-retention sweep deletes owner notifications and
-- staff notices by (is_read, created_at) across every tenant. IF NOT EXISTS so
-- an operator can pre-build either index CONCURRENTLY on a large table.
CREATE INDEX IF NOT EXISTS "notification_read_created_idx" ON "notification" USING btree ("is_read","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_notification_read_created_idx" ON "staff_notification" USING btree ("is_read","created_at");
