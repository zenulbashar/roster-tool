import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Programmatic sign-in for inbound prompt2eat SSO.
 *
 * The owner area uses Auth.js v5 with the DATABASE session strategy (see
 * `src/lib/auth/index.ts`). There is no `signIn("trust this verified email")`
 * for that strategy, and a Credentials provider would force JWT sessions, so we
 * mint the session the adapter's own way: match-or-provision the user in
 * Roster's OWN `user` table, insert a `session` row, and set the same session
 * cookie Auth.js reads. This creates a real Roster session in Roster's own
 * store — no prompt2eat cookie, table or secret is ever read or written.
 */

/** Auth.js database sessions default to a 30-day lifetime; match it. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The session cookie name + `secure` flag, mirroring Auth.js's own defaults.
 * Auth.js prefixes the cookie with `__Secure-` and sets `secure` when the site
 * is served over https, which we derive from the configured base URL (the same
 * `AUTH_URL`/`APP_URL` the rest of the app trusts).
 */
export function sessionCookieConfig(): { name: string; secure: boolean } {
  const baseUrl = env.AUTH_URL ?? env.APP_URL;
  const secure = baseUrl.startsWith("https:");
  return {
    name: `${secure ? "__Secure-" : ""}authjs.session-token`,
    secure,
  };
}

/**
 * Find the Roster user for `email` (case-insensitive), provisioning one on
 * first sign-in. The email is already verified by prompt2eat, so a new row is
 * created with `emailVerified` set. Insert races are resolved by the `user`
 * table's unique email guards (`onConflictDoNothing` then re-select).
 */
export async function matchOrProvisionUser(
  email: string,
  name?: string | null,
): Promise<{ id: string }> {
  const normalized = email.trim().toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(users)
    .values({
      email: normalized,
      name: name ?? null,
      emailVerified: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (inserted[0]) return inserted[0];

  // A concurrent request provisioned the same email first; read it back.
  const raced = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (raced[0]) return raced[0];

  // Should be unreachable: no row and no conflict.
  throw new Error("failed to match or provision SSO user");
}

/**
 * Insert a fresh database session for `userId` and return the opaque token to
 * place in the session cookie (Auth.js stores the token verbatim, unhashed, for
 * database sessions).
 */
export async function createDbSession(
  userId: string,
): Promise<{ sessionToken: string; expires: Date }> {
  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(sessions).values({ sessionToken, userId, expires });
  return { sessionToken, expires };
}
