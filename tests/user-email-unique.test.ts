import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * Integration coverage of the `user_email_lower_unique` guard index against
 * the real DB (runs on a local Postgres via DATABASE_URL from .env — Docker
 * may be unavailable; this never skips silently). The app already lowercases
 * emails on every sign-in path, so this index is a pure guard: it must reject
 * a case-variant duplicate account at the database level.
 */
describe("user email lower(email) unique index", () => {
  const email = `casetest-${crypto.randomUUID()}@example.com`;

  afterAll(async () => {
    await db.delete(users).where(sql`lower(${users.email}) = lower(${email})`);
  });

  it("rejects a case-variant duplicate insert", async () => {
    await db.insert(users).values({ email });

    // Drizzle wraps the Postgres error; the violated constraint is on `cause`.
    const variant = email.toUpperCase();
    const failure = await db
      .insert(users)
      .values({ email: variant })
      .then(() => null)
      .catch(
        (err: unknown) =>
          (err as Error).cause as {
            code?: string;
            constraint?: string;
          },
      );
    expect(failure).not.toBeNull();
    expect(failure?.code).toBe("23505"); // unique_violation
    expect(failure?.constraint).toBe("user_email_lower_unique");
  });

  it("still allows a distinct email", async () => {
    const other = `casetest-${crypto.randomUUID()}@example.com`;
    await db.insert(users).values({ email: other });
    await db.delete(users).where(sql`${users.email} = ${other}`);
  });
});
