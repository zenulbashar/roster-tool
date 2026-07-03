import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { ssoConsumedTokens } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * Single-use enforcement for inbound prompt2eat SSO tokens (`jti` replay guard).
 *
 * Each handoff token carries a random `jti`. We record it on first use; a second
 * presentation of the same `jti` is a replay and is rejected. The `jti` primary
 * key is the race-safe arbiter: an `onConflictDoNothing` insert returns no row
 * when the token was already spent, even under concurrent requests hitting many
 * serverless instances (the guard is durable in Postgres, not in memory).
 */

/** Garbage-collect consumed-token rows older than this (spec: ~10 minutes). */
const GC_AGE_MS = 10 * 60 * 1000;

/**
 * Record `jti` as consumed. Returns `true` if this is the first use (accept),
 * `false` if it was already recorded (replay → reject). Fails CLOSED: any
 * unexpected DB error returns `false` rather than risk allowing a replay.
 */
export async function consumeJti(
  jti: string,
  now: Date = new Date(),
): Promise<boolean> {
  let firstUse = false;
  try {
    const inserted = await db
      .insert(ssoConsumedTokens)
      .values({ jti, seenAt: now })
      .onConflictDoNothing()
      .returning({ jti: ssoConsumedTokens.jti });
    firstUse = inserted.length > 0;
  } catch (err) {
    logger.error({ err }, "SSO replay guard insert failed — rejecting");
    return false;
  }

  if (!firstUse) return false;

  // Best-effort sweep of expired rows; never let it fail the handoff.
  try {
    await gcConsumedTokens(now);
  } catch (err) {
    logger.warn({ err }, "SSO replay guard GC failed");
  }
  return true;
}

/** Delete consumed-token rows older than the retention window. */
export async function gcConsumedTokens(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - GC_AGE_MS);
  await db
    .delete(ssoConsumedTokens)
    .where(lt(ssoConsumedTokens.seenAt, cutoff));
}
