import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Single shared connection pool. In development Next.js hot-reloads modules,
 * which would otherwise leak a new pool on every change, so we cache it on
 * globalThis.
 */
const globalForDb = globalThis as unknown as {
  __rosterPool?: Pool;
};

const pool =
  globalForDb.__rosterPool ?? new Pool({ connectionString: env.DATABASE_URL });

if (env.NODE_ENV !== "production") {
  globalForDb.__rosterPool = pool;
}

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export { schema };
