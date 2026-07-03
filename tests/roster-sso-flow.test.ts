import { describe, it, expect, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, sessions, ssoConsumedTokens } from "@/lib/db/schema";
import { consumeJti, gcConsumedTokens } from "@/lib/sso/replay";
import {
  matchOrProvisionUser,
  createDbSession,
  sessionCookieConfig,
} from "@/lib/auth/sso-session";

/**
 * Integration coverage of the inbound-SSO side effects against the real DB
 * (runs on a local Postgres via DATABASE_URL). Exercises the replay guard's
 * single-use + GC behaviour, match-or-provision-by-email, and session creation.
 */

describe("SSO replay guard (jti single-use)", () => {
  const jtis: string[] = [];
  const track = () => {
    const jti = `sso-test-${crypto.randomUUID()}`;
    jtis.push(jti);
    return jti;
  };

  afterEach(async () => {
    for (const jti of jtis.splice(0)) {
      await db.delete(ssoConsumedTokens).where(eq(ssoConsumedTokens.jti, jti));
    }
  });

  it("accepts the first use and rejects a replay of the same jti", async () => {
    const jti = track();
    expect(await consumeJti(jti)).toBe(true);
    expect(await consumeJti(jti)).toBe(false);
    expect(await consumeJti(jti)).toBe(false);
  });

  it("garbage-collects rows older than the retention window", async () => {
    const jti = track();
    // Insert a row stamped well in the past.
    const old = new Date(Date.now() - 20 * 60 * 1000);
    await db.insert(ssoConsumedTokens).values({ jti, seenAt: old });

    await gcConsumedTokens();

    const rows = await db
      .select({ jti: ssoConsumedTokens.jti })
      .from(ssoConsumedTokens)
      .where(eq(ssoConsumedTokens.jti, jti));
    expect(rows).toHaveLength(0);
    // After GC the same jti can be consumed again (but such a token would be
    // long expired by its own ≤60s TTL, so this is safe).
    expect(await consumeJti(jti)).toBe(true);
  });
});

describe("matchOrProvisionUser + createDbSession", () => {
  const emails: string[] = [];

  afterEach(async () => {
    for (const email of emails.splice(0)) {
      await db
        .delete(users)
        .where(sql`lower(${users.email}) = lower(${email})`);
    }
  });

  it("provisions a new user by verified email and marks it verified", async () => {
    const email = `sso-owner-${crypto.randomUUID()}@example.com`;
    emails.push(email);

    const user = await matchOrProvisionUser(email, "Ada Owner");
    expect(user.id).toBeTruthy();

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row).toBeDefined();
    expect(row?.email).toBe(email.toLowerCase());
    expect(row?.name).toBe("Ada Owner");
    expect(row?.emailVerified).toBeInstanceOf(Date);
  });

  it("matches an existing user case-insensitively without creating a duplicate", async () => {
    const email = `sso-existing-${crypto.randomUUID()}@example.com`;
    emails.push(email);

    const first = await matchOrProvisionUser(email);
    const second = await matchOrProvisionUser(email.toUpperCase(), "Ignored");
    expect(second.id).toBe(first.id);

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    expect(rows).toHaveLength(1);
  });

  it("creates a database session row usable as an Auth.js session cookie", async () => {
    const email = `sso-session-${crypto.randomUUID()}@example.com`;
    emails.push(email);

    const user = await matchOrProvisionUser(email);
    const { sessionToken, expires } = await createDbSession(user.id);

    expect(sessionToken).toBeTruthy();
    expect(expires.getTime()).toBeGreaterThan(Date.now());

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionToken, sessionToken));
    expect(session?.userId).toBe(user.id);
    // Deleting the user cascades the session away.
    await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
  });
});

describe("sessionCookieConfig", () => {
  it("names the cookie the way Auth.js reads it", () => {
    const { name } = sessionCookieConfig();
    // http APP_URL in tests → no __Secure- prefix.
    expect(name).toBe("authjs.session-token");
  });
});
