import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Single shared connection pool. In development Next.js hot-reloads modules,
 * which would otherwise leak a new pool on every change, so we cache it on
 * globalThis.
 *
 * PERF-08 — the pool is sized and time-bounded deliberately:
 *  - `max`: the web app runs as many short-lived serverless instances, so each
 *    pool stays SMALL (connection count = max × instances, against a pooled
 *    Neon endpoint). The worker is one long-lived process and may hold more.
 *  - `statement_timeout`: bounds the blast radius of a pathological query —
 *    without it one slow statement holds a connection until the platform
 *    kills the request, the classic path from "a slow page" to "the site is
 *    down". Web requests get seconds; job handlers get a minute. Migrations
 *    use their own pool (scripts/migrate.ts) and are NOT bounded here.
 *  - `idle_in_transaction_session_timeout`: a transaction left open by a bug
 *    can't pin a connection (and its locks) indefinitely.
 *  - `application_name`: so pg_stat_activity attributes connections to the
 *    web app vs the worker.
 */
const isWorker = env.ROSTER_ROLE === "worker";

const globalForDb = globalThis as unknown as {
  __rosterPool?: Pool;
};

const pool =
  globalForDb.__rosterPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: isWorker ? 10 : 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: isWorker ? "roster-worker" : "roster-web",
    statement_timeout: isWorker ? 60_000 : 10_000,
    idle_in_transaction_session_timeout: 15_000,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.__rosterPool = pool;
}

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export { schema };
