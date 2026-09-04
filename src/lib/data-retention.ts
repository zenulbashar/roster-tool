import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  notifications,
  staffNotifications,
  adminActivities,
  formRateLimits,
  workerHeartbeats,
  sessions,
  verificationTokens,
  ssoConsumedTokens,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * Data retention for the tables that only ever grew (PERF-10).
 *
 * Every table below had NO deletion path: the owner bell, the staff notices,
 * the admin audit log, the public-form rate-limit buckets, and the auth /
 * infrastructure rows that expire but were never swept. Growth was monotonic
 * and fastest for the busiest customers. One daily job now applies one
 * explicit policy per table.
 *
 * Policies are CODE, not configuration — a retention period is a product and
 * compliance decision that should be reviewed in a diff, not flipped in an
 * environment variable. Each is stated in days from the row's own timestamp:
 *
 *  - owner notifications: READ rows after 180 days, UNREAD after 365 (an
 *    unread item is still "new" to the owner, so it lives longer);
 *  - staff notices: the same 180 / 365 split;
 *  - admin activity (the impersonation accountability record): 24 months.
 *    Check the contractual/regulatory floor before shortening this;
 *  - form rate-limit buckets: as soon as the window has expired;
 *  - worker heartbeats: instances not seen for 7 days (each deploy leaves a
 *    row behind; /api/ready reads only the newest);
 *  - Auth.js sessions + magic-link verification tokens: one day after they
 *    expired (Auth.js deletes on use, never on expiry);
 *  - consumed SSO token ids: one day after they were seen (the hot path GCs
 *    after ~10 min; this is the belt to that brace).
 *
 * Deletes run in BOUNDED BATCHES (`id IN (SELECT … LIMIT n)`) so a first run
 * over a large backlog never holds a long lock or bloats one transaction;
 * every policy is idempotent (a second run deletes nothing). Clock-in photos
 * keep their own per-business job (`photo-retention`) — owners choose that
 * period; these are platform-level.
 */

export const RETENTION_DAYS = {
  notificationRead: 180,
  notificationUnread: 365,
  staffNotificationRead: 180,
  staffNotificationUnread: 365,
  adminActivity: 730,
  workerHeartbeat: 7,
  authSessionExpired: 1,
  verificationTokenExpired: 1,
  ssoConsumedToken: 1,
} as const;

export type RetentionPolicy = keyof typeof RETENTION_DAYS | "formRateLimit";

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  "notificationRead",
  "notificationUnread",
  "staffNotificationRead",
  "staffNotificationUnread",
  "adminActivity",
  "formRateLimit",
  "workerHeartbeat",
  "authSessionExpired",
  "verificationTokenExpired",
  "ssoConsumedToken",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The instant before which a row is past `days` of retention. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** Rows deleted per batch; small enough to keep every statement short. */
export const RETENTION_BATCH_SIZE = 5000;

export type RetentionResult = Record<RetentionPolicy, number>;

type Deleter = (database: Db) => Promise<number>;

const rowCount = (res: unknown): number =>
  ((res as { rowCount?: number | null }).rowCount ?? 0) as number;

/** Delete in batches until a batch comes back short; returns the total. */
async function drain(
  database: Db,
  deleteBatch: Deleter,
  batchSize = RETENTION_BATCH_SIZE,
): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await deleteBatch(database);
    total += n;
    if (n < batchSize) return total;
  }
}

/**
 * Apply every retention policy as of `now`. Returns the rows deleted per
 * policy (all zeros on a clean, already-swept database).
 */
export async function sweepRetention(
  now: Date = new Date(),
  database: Db = defaultDb,
  batchSize = RETENTION_BATCH_SIZE,
): Promise<RetentionResult> {
  const cut = (days: number) => retentionCutoff(now, days);

  const notificationsWhere = (read: boolean, days: number) =>
    and(eq(notifications.isRead, read), lt(notifications.createdAt, cut(days)));
  const staffNotificationsWhere = (read: boolean, days: number) =>
    and(
      eq(staffNotifications.isRead, read),
      lt(staffNotifications.createdAt, cut(days)),
    );

  const deleteNotifications =
    (read: boolean, days: number): Deleter =>
    async (d) =>
      rowCount(
        await d
          .delete(notifications)
          .where(
            inArray(
              notifications.id,
              d
                .select({ id: notifications.id })
                .from(notifications)
                .where(notificationsWhere(read, days))
                .limit(batchSize),
            ),
          ),
      );

  const deleteStaffNotifications =
    (read: boolean, days: number): Deleter =>
    async (d) =>
      rowCount(
        await d
          .delete(staffNotifications)
          .where(
            inArray(
              staffNotifications.id,
              d
                .select({ id: staffNotifications.id })
                .from(staffNotifications)
                .where(staffNotificationsWhere(read, days))
                .limit(batchSize),
            ),
          ),
      );

  const result: RetentionResult = {
    notificationRead: await drain(
      database,
      deleteNotifications(true, RETENTION_DAYS.notificationRead),
      batchSize,
    ),
    notificationUnread: await drain(
      database,
      deleteNotifications(false, RETENTION_DAYS.notificationUnread),
      batchSize,
    ),
    staffNotificationRead: await drain(
      database,
      deleteStaffNotifications(true, RETENTION_DAYS.staffNotificationRead),
      batchSize,
    ),
    staffNotificationUnread: await drain(
      database,
      deleteStaffNotifications(false, RETENTION_DAYS.staffNotificationUnread),
      batchSize,
    ),
    adminActivity: await drain(
      database,
      async (d) =>
        rowCount(
          await d.delete(adminActivities).where(
            inArray(
              adminActivities.id,
              d
                .select({ id: adminActivities.id })
                .from(adminActivities)
                .where(
                  lt(
                    adminActivities.createdAt,
                    cut(RETENTION_DAYS.adminActivity),
                  ),
                )
                .limit(batchSize),
            ),
          ),
        ),
      batchSize,
    ),
    formRateLimit: await drain(
      database,
      async (d) =>
        rowCount(
          await d
            .delete(formRateLimits)
            .where(
              inArray(
                formRateLimits.bucketKey,
                d
                  .select({ k: formRateLimits.bucketKey })
                  .from(formRateLimits)
                  .where(lt(formRateLimits.expiresAt, now))
                  .limit(batchSize),
              ),
            ),
        ),
      batchSize,
    ),
    workerHeartbeat: rowCount(
      await database
        .delete(workerHeartbeats)
        .where(
          lt(workerHeartbeats.seenAt, cut(RETENTION_DAYS.workerHeartbeat)),
        ),
    ),
    authSessionExpired: await drain(
      database,
      async (d) =>
        rowCount(
          await d.delete(sessions).where(
            inArray(
              sessions.sessionToken,
              d
                .select({ t: sessions.sessionToken })
                .from(sessions)
                .where(
                  lt(sessions.expires, cut(RETENTION_DAYS.authSessionExpired)),
                )
                .limit(batchSize),
            ),
          ),
        ),
      batchSize,
    ),
    verificationTokenExpired: await drain(
      database,
      async (d) =>
        rowCount(
          await d.delete(verificationTokens).where(
            inArray(
              verificationTokens.token,
              d
                .select({ t: verificationTokens.token })
                .from(verificationTokens)
                .where(
                  lt(
                    verificationTokens.expires,
                    cut(RETENTION_DAYS.verificationTokenExpired),
                  ),
                )
                .limit(batchSize),
            ),
          ),
        ),
      batchSize,
    ),
    ssoConsumedToken: rowCount(
      await database
        .delete(ssoConsumedTokens)
        .where(
          lt(ssoConsumedTokens.seenAt, cut(RETENTION_DAYS.ssoConsumedToken)),
        ),
    ),
  };

  logger.info(
    { ...result, cutoffsFrom: now.toISOString() },
    "Data retention sweep complete",
  );
  return result;
}

/** Sum of a result, for the job log line / tests. */
export function totalDeleted(result: RetentionResult): number {
  return Object.values(result).reduce((a, b) => a + b, 0);
}

// Keep `sql` imported for the day a policy needs a raw predicate; also
// documents that raw SQL is acceptable here (infrastructure tables, no tenant
// predicate to preserve).
void sql;
