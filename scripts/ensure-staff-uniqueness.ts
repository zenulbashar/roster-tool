/**
 * COR-03 — org-level staff identity.
 *
 * Reports every organisation where the same email appears on more than one
 * `staff_member` row (the "two PINs, two rates, split hours" defect), and —
 * ONLY when there are none — creates the partial unique index that stops it
 * recurring (`staff_member_org_email_lower_unique`, the same statement
 * migration 0040 runs conditionally). Nothing is merged: merging timesheets
 * is the owner's decision, made on /app/people.
 *
 * Exit code 1 while duplicates remain, so it can gate a deploy step.
 *
 *   npm run staff:ensure-unique
 */
import { Pool } from "pg";
import { env } from "../src/lib/env";
import { logger } from "../src/lib/logger";

const INDEX_NAME = "staff_member_org_email_lower_unique";

const DUPLICATES_SQL = `
  SELECT o.name AS org_name,
         coalesce(sm.org_id, b.org_id) AS org_id,
         lower(sm.email) AS email,
         count(*)::int AS rows,
         array_agg(sm.name ORDER BY sm.created_at) AS names
    FROM staff_member sm
    JOIN business b ON b.id = sm.business_id
    LEFT JOIN organisation o ON o.id = coalesce(sm.org_id, b.org_id)
   GROUP BY 1, 2, 3
  HAVING count(*) > 1
   ORDER BY 1, 3
`;

const CREATE_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}"
    ON "staff_member" ("org_id", lower("email"))
    WHERE "org_id" IS NOT NULL
`;

async function main() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const dupes = await pool.query<{
      org_name: string | null;
      org_id: string;
      email: string;
      rows: number;
      names: string[];
    }>(DUPLICATES_SQL);

    if (dupes.rows.length > 0) {
      for (const d of dupes.rows) {
        // The email is the duplicate key — logged deliberately here (an
        // operator report), unlike application logs, which redact it.
        logger.warn(
          {
            org: d.org_name ?? d.org_id,
            identity: d.email,
            rows: d.rows,
            names: d.names,
          },
          "Duplicate person in organisation",
        );
      }
      logger.error(
        { duplicates: dupes.rows.length },
        `Duplicate people exist — ${INDEX_NAME} NOT created. Owners resolve these on /app/people (keep one record, deactivate the other); re-run once clean.`,
      );
      process.exitCode = 1;
      return;
    }

    await pool.query(CREATE_INDEX_SQL);
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = $1`,
      [INDEX_NAME],
    );
    logger.info(
      { index: INDEX_NAME, present: rows.length === 1 },
      "No duplicate people; org-level staff uniqueness index is in place.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, "ensure-staff-uniqueness failed");
  process.exitCode = 1;
});
