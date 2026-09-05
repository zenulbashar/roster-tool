-- UX-04: SOFT-delete timesheet entries. An entry is the wage evidence for a
-- shift worked, so the owner's "Delete" now sets `deleted_at` instead of
-- removing the row (every tenant read filters it; it can be restored). The
-- one-open-entry guard counts only LIVE rows, so deleting a stale "still
-- clocked in" entry frees the person to clock in again.
ALTER TABLE "timesheet_entry" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "timesheet_entry_one_open_per_staff";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timesheet_entry_one_open_per_staff" ON "timesheet_entry" USING btree ("staff_member_id") WHERE "timesheet_entry"."clock_out_at" is null and "timesheet_entry"."deleted_at" is null;
