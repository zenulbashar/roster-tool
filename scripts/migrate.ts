/**
 * Applies pending Drizzle migrations. Safe to run repeatedly and when no
 * migrations exist yet (e.g. before the first schema is generated).
 */
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { env } from "../src/lib/env";
import { logger } from "../src/lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../drizzle");

async function main() {
  const hasMigrations =
    existsSync(migrationsFolder) &&
    readdirSync(migrationsFolder).some((f) => f.endsWith(".sql"));

  if (!hasMigrations) {
    logger.info("No migrations found yet — nothing to apply.");
    return;
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    logger.info("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, "Migration failed");
  process.exitCode = 1;
});
