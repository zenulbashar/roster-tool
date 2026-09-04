import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  businesses,
  staffMembers,
  notifications,
  staffNotifications,
  adminActivities,
  formRateLimits,
  workerHeartbeats,
  users,
  sessions,
  verificationTokens,
  ssoConsumedTokens,
} from "@/lib/db/schema";
import { sweepRetention, RETENTION_DAYS } from "@/lib/data-retention";

/**
 * PERF-10 — the retention sweep against Postgres: each policy deletes exactly
 * the rows past its cutoff, keeps the rest (including unread notices that a
 * READ cutoff would have taken), batches correctly, and is idempotent. Every
 * seeded row is dated relative to a fixed NOW far enough in the past that no
 * other test file's freshly-created rows can fall under a cutoff.
 */
describe("data retention sweep (flow)", () => {
  const NOW = new Date("2026-09-04T04:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

  let bizId = "";
  let staffId = "";
  let userId = "";
  const ids = {
    readOld: "",
    readFresh: "",
    unreadOld: "",
    unreadMiddle: "",
    staffReadOld: "",
    staffUnreadMiddle: "",
    adminOld: "",
    adminFresh: "",
  };

  beforeAll(async () => {
    const [b] = await db
      .insert(businesses)
      .values({ name: "Retention Sweep Biz" })
      .returning();
    bizId = b!.id;
    const [s] = await db
      .insert(staffMembers)
      .values({ businessId: bizId, name: "Ret Staff", email: "ret@x.test" })
      .returning();
    staffId = s!.id;
    const [u] = await db
      .insert(users)
      .values({ email: `retention-${Date.now()}@x.test` })
      .returning();
    userId = u!.id;

    const note = (isRead: boolean, createdAt: Date) => ({
      businessId: bizId,
      type: "leave_requested" as const,
      title: "t",
      isRead,
      createdAt,
    });
    const [readOld, readFresh, unreadOld, unreadMiddle] = await db
      .insert(notifications)
      .values([
        note(true, ago(RETENTION_DAYS.notificationRead + 1)),
        note(true, ago(RETENTION_DAYS.notificationRead - 1)),
        note(false, ago(RETENTION_DAYS.notificationUnread + 1)),
        // Older than the READ cutoff but unread: must survive.
        note(false, ago(RETENTION_DAYS.notificationRead + 1)),
      ])
      .returning({ id: notifications.id });
    ids.readOld = readOld!.id;
    ids.readFresh = readFresh!.id;
    ids.unreadOld = unreadOld!.id;
    ids.unreadMiddle = unreadMiddle!.id;

    const staffNote = (isRead: boolean, createdAt: Date) => ({
      businessId: bizId,
      staffMemberId: staffId,
      type: "rostered" as const,
      title: "t",
      isRead,
      createdAt,
    });
    const [staffReadOld, staffUnreadMiddle] = await db
      .insert(staffNotifications)
      .values([
        staffNote(true, ago(RETENTION_DAYS.staffNotificationRead + 1)),
        staffNote(false, ago(RETENTION_DAYS.staffNotificationRead + 1)),
      ])
      .returning({ id: staffNotifications.id });
    ids.staffReadOld = staffReadOld!.id;
    ids.staffUnreadMiddle = staffUnreadMiddle!.id;

    const [adminOld, adminFresh] = await db
      .insert(adminActivities)
      .values([
        {
          adminName: "Priya",
          action: "old",
          createdAt: ago(RETENTION_DAYS.adminActivity + 1),
        },
        {
          adminName: "Priya",
          action: "fresh",
          // 330 days old: kept now, and still inside 24 months at NOW + 200 d.
          createdAt: ago(RETENTION_DAYS.adminActivity - 400),
        },
      ])
      .returning({ id: adminActivities.id });
    ids.adminOld = adminOld!.id;
    ids.adminFresh = adminFresh!.id;

    await db.insert(formRateLimits).values([
      { bucketKey: "ret:expired:1", count: 3, expiresAt: ago(1) },
      { bucketKey: "ret:expired:2", count: 3, expiresAt: ago(0.5) },
      {
        bucketKey: "ret:live:1",
        count: 1,
        expiresAt: new Date(NOW.getTime() + DAY),
      },
    ]);
    await db.insert(workerHeartbeats).values([
      {
        id: "ret-worker-dead",
        seenAt: ago(RETENTION_DAYS.workerHeartbeat + 1),
      },
      { id: "ret-worker-live", seenAt: ago(1) },
    ]);
    await db.insert(sessions).values([
      { sessionToken: "ret-session-expired", userId, expires: ago(2) },
      { sessionToken: "ret-session-just-expired", userId, expires: ago(0.5) },
      {
        sessionToken: "ret-session-live",
        userId,
        expires: new Date(NOW.getTime() + 30 * DAY),
      },
    ]);
    await db.insert(verificationTokens).values([
      { identifier: "ret@x.test", token: "ret-vt-expired", expires: ago(2) },
      {
        identifier: "ret@x.test",
        token: "ret-vt-live",
        expires: new Date(NOW.getTime() + DAY),
      },
    ]);
    await db.insert(ssoConsumedTokens).values([
      { jti: "ret-jti-old", seenAt: ago(2) },
      { jti: "ret-jti-fresh", seenAt: ago(0.1) },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(formRateLimits)
      .where(
        inArray(formRateLimits.bucketKey, [
          "ret:expired:1",
          "ret:expired:2",
          "ret:live:1",
        ]),
      );
    await db
      .delete(workerHeartbeats)
      .where(
        inArray(workerHeartbeats.id, ["ret-worker-dead", "ret-worker-live"]),
      );
    await db
      .delete(verificationTokens)
      .where(
        inArray(verificationTokens.token, ["ret-vt-expired", "ret-vt-live"]),
      );
    await db
      .delete(ssoConsumedTokens)
      .where(inArray(ssoConsumedTokens.jti, ["ret-jti-old", "ret-jti-fresh"]));
    await db
      .delete(adminActivities)
      .where(inArray(adminActivities.id, [ids.adminOld, ids.adminFresh]));
    if (userId) await db.delete(users).where(eq(users.id, userId)); // cascades sessions
    if (bizId) await db.delete(businesses).where(eq(businesses.id, bizId));
    await db.$client.end();
  });

  const exists = async (table: "n" | "sn" | "aa", id: string) => {
    const rows =
      table === "n"
        ? await db.select().from(notifications).where(eq(notifications.id, id))
        : table === "sn"
          ? await db
              .select()
              .from(staffNotifications)
              .where(eq(staffNotifications.id, id))
          : await db
              .select()
              .from(adminActivities)
              .where(eq(adminActivities.id, id));
    return rows.length > 0;
  };

  it("deletes exactly the rows past each policy's cutoff and keeps the rest", async () => {
    // A batch size of 1 exercises the drain loop across several batches.
    const result = await sweepRetention(NOW, db, 1);

    expect(result.notificationRead).toBeGreaterThanOrEqual(1);
    expect(result.notificationUnread).toBeGreaterThanOrEqual(1);
    expect(await exists("n", ids.readOld)).toBe(false);
    expect(await exists("n", ids.unreadOld)).toBe(false);
    expect(await exists("n", ids.readFresh)).toBe(true);
    expect(await exists("n", ids.unreadMiddle)).toBe(true); // unread survives the read cutoff

    expect(result.staffNotificationRead).toBeGreaterThanOrEqual(1);
    expect(await exists("sn", ids.staffReadOld)).toBe(false);
    expect(await exists("sn", ids.staffUnreadMiddle)).toBe(true);

    expect(result.adminActivity).toBeGreaterThanOrEqual(1);
    expect(await exists("aa", ids.adminOld)).toBe(false);
    expect(await exists("aa", ids.adminFresh)).toBe(true);

    expect(result.formRateLimit).toBeGreaterThanOrEqual(2);
    const buckets = await db
      .select({ k: formRateLimits.bucketKey })
      .from(formRateLimits)
      .where(
        inArray(formRateLimits.bucketKey, [
          "ret:expired:1",
          "ret:expired:2",
          "ret:live:1",
        ]),
      );
    expect(buckets.map((b) => b.k)).toEqual(["ret:live:1"]);

    expect(result.workerHeartbeat).toBeGreaterThanOrEqual(1);
    const beats = await db
      .select({ id: workerHeartbeats.id })
      .from(workerHeartbeats)
      .where(
        inArray(workerHeartbeats.id, ["ret-worker-dead", "ret-worker-live"]),
      );
    expect(beats.map((b) => b.id)).toEqual(["ret-worker-live"]);

    // Sessions: expired > 1 day ago go; just-expired and live stay.
    expect(result.authSessionExpired).toBeGreaterThanOrEqual(1);
    const sess = await db
      .select({ t: sessions.sessionToken })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    expect(sess.map((s) => s.t).sort()).toEqual([
      "ret-session-just-expired",
      "ret-session-live",
    ]);

    expect(result.verificationTokenExpired).toBeGreaterThanOrEqual(1);
    const vts = await db
      .select({ t: verificationTokens.token })
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, "ret@x.test"));
    expect(vts.map((v) => v.t)).toEqual(["ret-vt-live"]);

    expect(result.ssoConsumedToken).toBeGreaterThanOrEqual(1);
    const jtis = await db
      .select({ j: ssoConsumedTokens.jti })
      .from(ssoConsumedTokens)
      .where(inArray(ssoConsumedTokens.jti, ["ret-jti-old", "ret-jti-fresh"]));
    expect(jtis.map((j) => j.j)).toEqual(["ret-jti-fresh"]);
  });

  it("is idempotent: a second sweep at the same instant deletes nothing of ours", async () => {
    const before = {
      readFresh: await exists("n", ids.readFresh),
      unreadMiddle: await exists("n", ids.unreadMiddle),
      staffUnreadMiddle: await exists("sn", ids.staffUnreadMiddle),
      adminFresh: await exists("aa", ids.adminFresh),
    };
    expect(before).toEqual({
      readFresh: true,
      unreadMiddle: true,
      staffUnreadMiddle: true,
      adminFresh: true,
    });
    await sweepRetention(NOW, db);
    expect(await exists("n", ids.readFresh)).toBe(true);
    expect(await exists("n", ids.unreadMiddle)).toBe(true);
    expect(await exists("sn", ids.staffUnreadMiddle)).toBe(true);
    expect(await exists("aa", ids.adminFresh)).toBe(true);
  });

  it("a later sweep takes the rows that have since aged past their cutoff", async () => {
    // +200 days: the 181-day-old unread notices pass the 365-day cutoff and
    // the 179-day-old read one passes 180; the 330-day-old admin row does not
    // reach 730.
    const later = new Date(NOW.getTime() + 200 * DAY);
    await sweepRetention(later, db);
    // Now every notice of ours is past even the unread cutoff.
    expect(await exists("n", ids.readFresh)).toBe(false);
    expect(await exists("n", ids.unreadMiddle)).toBe(false);
    expect(await exists("sn", ids.staffUnreadMiddle)).toBe(false);
    // ...but the admin row is still inside its 24 months.
    expect(await exists("aa", ids.adminFresh)).toBe(true);
  });
});
