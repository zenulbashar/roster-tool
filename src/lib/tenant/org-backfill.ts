import { sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";

/**
 * Idempotent organisation / staff-location backfill for the M29 multi-location
 * rollout (Strategy A — staff collapse to the org). Gives every pre-existing
 * single-location owner an organisation so the app can treat `org_id` as
 * populated: one org per business (reusing the business id as the org id for a
 * trivially linkable 1:1 mapping), a membership per onboarded owner, each staff
 * member pointed at its home business's org, and one `staff_location` per staff
 * member at its home location.
 *
 * The CANONICAL copy of this logic is the DML appended to migration
 * `drizzle/0023_burly_doctor_strange.sql`, which runs once at migrate time. This
 * function mirrors it statement-for-statement so the same backfill can be
 * re-run as a repair (e.g. after an out-of-band insert) and is unit-tested.
 * Every statement is guarded (`IS NULL` / `ON CONFLICT DO NOTHING`), so calling
 * it repeatedly is a no-op — keep the two copies in sync.
 */
export async function backfillOrgs(database: Db = defaultDb): Promise<void> {
  // 1. One organisation per existing business (id reused → linkable & idempotent).
  await database.execute(sql`
    INSERT INTO "organisation" ("id", "name", "default_timezone")
    SELECT "id", "name", "timezone" FROM "business"
    ON CONFLICT ("id") DO NOTHING
  `);
  // 2. Point each business at its organisation.
  await database.execute(sql`
    UPDATE "business" SET "org_id" = "id" WHERE "org_id" IS NULL
  `);
  // 3. Point each staff member at its home business's organisation.
  await database.execute(sql`
    UPDATE "staff_member" AS sm SET "org_id" = b."org_id"
    FROM "business" b
    WHERE sm."business_id" = b."id" AND sm."org_id" IS NULL
  `);
  // 4. Make each onboarded owner a member (role 'owner') of their business's org.
  await database.execute(sql`
    INSERT INTO "org_membership" ("org_id", "user_id", "role")
    SELECT b."org_id", u."id", 'owner'
    FROM "user" u JOIN "business" b ON u."businessId" = b."id"
    WHERE b."org_id" IS NOT NULL
    ON CONFLICT ("org_id", "user_id") DO NOTHING
  `);
  // 5. One staff_location membership per existing staff member at its home location.
  await database.execute(sql`
    INSERT INTO "staff_location" ("org_id", "business_id", "staff_member_id", "active")
    SELECT sm."org_id", sm."business_id", sm."id", sm."active"
    FROM "staff_member" sm
    WHERE sm."org_id" IS NOT NULL
    ON CONFLICT ("business_id", "staff_member_id") DO NOTHING
  `);
}
