import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { formRateLimits } from "@/lib/db/schema";

/**
 * Durable, fixed-window rate limiting for PUBLIC form submissions.
 *
 * Durable (a DB table, not in-memory) for the same reason the PIN lockout is:
 * the app runs on multiple serverless instances where in-process counters are
 * unreliable. One bucket row per (key, window) is upsert-incremented; each
 * window is a distinct `bucket_key`, so windows roll over with no cleanup on
 * the hot path (rows just expire and can be swept later).
 *
 * IP limiting is BEST-EFFORT: the IP comes from x-forwarded-for, which can be
 * shared (NAT) or spoofed. Turnstile is the primary bot gate; this is only a
 * coarse flood ceiling.
 */

/** Hash an IP so the limiter never stores raw addresses (PII). */
export function hashIp(ip: string | null | undefined): string {
  return createHash("sha256")
    .update(ip && ip.length > 0 ? ip : "unknown")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Per-(IP, slug) ceilings. Deliberately HIGH: the QR-in-a-busy-venue case means
 * many legitimate patrons share one NAT'd IP submitting one form, so a tight
 * limit would block real customers. These are last-resort volumetric caps, not
 * the primary defence (that's Turnstile). Tune here.
 */
export const FORM_SUBMIT_LIMITS = [
  { kind: "min", windowMs: 60_000, max: 40 }, // 40 / minute per (ip, slug)
  { kind: "hour", windowMs: 3_600_000, max: 400 }, // 400 / hour per (ip, slug)
] as const;

/**
 * Increment the counter for one fixed window and report whether it is still
 * within `max`. Exported so the windowing logic is unit-testable with small
 * numbers. Returns true when allowed (count <= max), false when exceeded.
 */
export async function consumeWindow(
  database: Db,
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  const epoch = Math.floor(now / windowMs);
  const bucketKey = `${key}:${epoch}`;
  const expiresAt = new Date((epoch + 1) * windowMs);
  const [row] = await database
    .insert(formRateLimits)
    .values({ bucketKey, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: formRateLimits.bucketKey,
      set: { count: sql`${formRateLimits.count} + 1` },
    })
    .returning({ count: formRateLimits.count });
  return (row?.count ?? 0) <= max;
}

/**
 * Consume one submission slot for (ipHash, slug) across every configured
 * window. Returns true only if under EVERY ceiling. All windows are incremented
 * even when one is already exceeded (a flood still counts).
 */
export async function consumeFormSubmission(
  ipHash: string,
  slug: string,
  database: Db = defaultDb,
  now: number = Date.now(),
): Promise<boolean> {
  let allowed = true;
  for (const limit of FORM_SUBMIT_LIMITS) {
    const ok = await consumeWindow(
      database,
      `f:${slug}:${ipHash}:${limit.kind}`,
      limit.max,
      limit.windowMs,
      now,
    );
    if (!ok) allowed = false;
  }
  return allowed;
}

/**
 * Per-DEVICE PIN-attempt ceiling (SEC-06). The per-staff lockout caps how fast
 * one PERSON's PIN can be guessed, but it is keyed on the victim: anyone with
 * a kiosk link could lock every staff member out of clocking in with five
 * wrong PINs each, indefinitely. This caps the ATTACKER instead — attempts
 * per capability token (the kiosk, personal-clock or /me link), whichever
 * staff member they target. Generous enough that a real shift change never
 * hits it; tight enough that a guessing loop does within a minute.
 */
export const PIN_ATTEMPT_LIMITS = [
  { kind: "min", windowMs: 60_000, max: 20 },
  { kind: "hour", windowMs: 3_600_000, max: 200 },
] as const;

/**
 * Consume one PIN attempt for a device key (the SHA-256 of its capability
 * token — never a staff identifier, so the bucket reveals nothing about who
 * is being targeted). Returns true when still under every ceiling.
 */
export async function consumePinAttempt(
  deviceKey: string,
  database: Db = defaultDb,
  now: number = Date.now(),
): Promise<boolean> {
  let allowed = true;
  for (const limit of PIN_ATTEMPT_LIMITS) {
    const ok = await consumeWindow(
      database,
      `pin:${deviceKey}:${limit.kind}`,
      limit.max,
      limit.windowMs,
      now,
    );
    if (!ok) allowed = false;
  }
  return allowed;
}

/**
 * COARSE per-form flood ceiling for ANONYMOUS internal (staff) submissions.
 *
 * Anonymous internal responses store NO respondent, so the partial-unique
 * one-per-staff guard can't bound them and a logged-in staff member could
 * otherwise spam an anonymous form within their 15-minute PIN proof. This caps
 * total anonymous submissions per form per window.
 *
 * CRITICAL — anonymity: the key is keyed ONLY on the form id
 * (`internal:<formId>:<window>`), NEVER on any staff identifier. A staff-id key
 * would be a de-anonymisation vector — anyone with DB read access (the owner)
 * could recompute hash(staffId+form+window) and time-correlate a bucket with an
 * anonymous submission. The form-only key reveals only "some anonymous
 * submission to form X happened in window W", which is already implied by the
 * response existing.
 */
export const INTERNAL_ANON_LIMITS = [
  { kind: "min", windowMs: 60_000, max: 30 }, // 30 / minute per form
  { kind: "hour", windowMs: 3_600_000, max: 300 }, // 300 / hour per form
] as const;

/**
 * Consume one slot for an ANONYMOUS internal submission to `formId`. Returns
 * true only if under every per-form ceiling. NO staff identifier is involved.
 */
export async function consumeInternalAnonSubmission(
  formId: string,
  database: Db = defaultDb,
  now: number = Date.now(),
): Promise<boolean> {
  let allowed = true;
  for (const limit of INTERNAL_ANON_LIMITS) {
    const ok = await consumeWindow(
      database,
      `internal:${formId}:${limit.kind}`,
      limit.max,
      limit.windowMs,
      now,
    );
    if (!ok) allowed = false;
  }
  return allowed;
}
