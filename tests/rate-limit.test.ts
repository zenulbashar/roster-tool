import { describe, it, expect, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { formRateLimits } from "@/lib/db/schema";
import { consumeWindow, hashIp } from "@/lib/rate-limit";

/**
 * Durable fixed-window limiter against the real DB: a window allows up to `max`
 * consumes then rejects, and a later window re-arms. Keys are namespaced so the
 * test cleans up only its own rows.
 */
describe("rate limiter", () => {
  const PREFIX = `test-rl-${Date.now()}`;

  afterAll(async () => {
    await db
      .delete(formRateLimits)
      .where(like(formRateLimits.bucketKey, `${PREFIX}%`));
    await db.$client.end();
  });

  it("allows up to max within a window then rejects", async () => {
    const key = `${PREFIX}:a`;
    const max = 2;
    const windowMs = 60_000;
    const now = 1_000_000_000;
    expect(await consumeWindow(db, key, max, windowMs, now)).toBe(true); // 1
    expect(await consumeWindow(db, key, max, windowMs, now)).toBe(true); // 2
    expect(await consumeWindow(db, key, max, windowMs, now)).toBe(false); // 3 > max
    expect(await consumeWindow(db, key, max, windowMs, now)).toBe(false); // still over
  });

  it("re-arms in a fresh window", async () => {
    const key = `${PREFIX}:b`;
    const max = 1;
    const windowMs = 60_000;
    const now = 2_000_000_000;
    expect(await consumeWindow(db, key, max, windowMs, now)).toBe(true);
    expect(await consumeWindow(db, key, max, windowMs, now)).toBe(false);
    // Advance past the window boundary → new bucket key → allowed again.
    expect(await consumeWindow(db, key, max, windowMs, now + windowMs)).toBe(
      true,
    );
  });

  it("hashes ips without leaking the raw value", () => {
    const h = hashIp("203.0.113.7");
    expect(h).not.toContain("203.0.113.7");
    expect(h).toHaveLength(32);
    expect(hashIp(null)).toBe(hashIp(""));
  });
});
