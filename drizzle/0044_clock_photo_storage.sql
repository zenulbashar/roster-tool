-- PERF-06 expand step: clock-in photo bytes move to object storage. The row
-- keeps the facts (entry, in/out, mime, size, checksum) plus a storage_key;
-- image_data becomes nullable and is dropped by hand in the CONTRACT step
-- once the backfill has verified every object (docs/operations.md 5.3).
ALTER TABLE "clock_photo" ALTER COLUMN "image_data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clock_photo" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "clock_photo" ADD COLUMN "content_length" integer;--> statement-breakpoint
ALTER TABLE "clock_photo" ADD COLUMN "checksum" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clock_photo_unstored_idx" ON "clock_photo" USING btree ("created_at","id") WHERE "clock_photo"."storage_key" is null;--> statement-breakpoint
ALTER TABLE "clock_photo" ADD CONSTRAINT "clock_photo_bytes_or_key_check" CHECK ("clock_photo"."image_data" is not null or "clock_photo"."storage_key" is not null);