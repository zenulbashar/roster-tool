-- COR-03: one person = one org-level staff_member row. The partial unique
-- index on (org_id, lower(email)) makes the "same email twice in one
-- organisation" defect (two PINs, two pay rates, split hours) impossible.
--
-- DEFENSIVE: the index is created ONLY when no duplicates exist. A database
-- that already holds duplicates keeps its schema unchanged and gets a WARNING
-- instead — an operator resolves the pairs first (owners keep one record and
-- deactivate the other on /app/people; nothing is merged automatically,
-- merging hours is their decision), then runs `npm run staff:ensure-unique`,
-- which prints the report and creates this same index once clean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "staff_member"
     WHERE "org_id" IS NOT NULL
     GROUP BY "org_id", lower("email")
    HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'staff_member_org_email_lower_unique NOT created: duplicate people exist (same email twice in one organisation). Resolve them on /app/people, then run `npm run staff:ensure-unique`.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "staff_member_org_email_lower_unique"
      ON "staff_member" USING btree ("org_id", lower("email"))
      WHERE "org_id" IS NOT NULL;
  END IF;
END $$;
