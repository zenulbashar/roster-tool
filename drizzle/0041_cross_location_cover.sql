-- PROD-15: cross-location shift cover becomes an owner SETTING per location
-- (plus a per-release choice) instead of an automatic consequence of having
-- two venues. Default OFF for locations created from now on. Every location
-- that ALREADY sits in a multi-location organisation is switched ON so no
-- existing owner's behaviour changes on deploy — they can turn it off in
-- Settings.
ALTER TABLE "business" ADD COLUMN IF NOT EXISTS "allow_cross_location_cover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "business" SET "allow_cross_location_cover" = true
 WHERE "org_id" IN (
   SELECT "org_id" FROM "business" WHERE "org_id" IS NOT NULL
   GROUP BY "org_id" HAVING count(*) > 1
 );
