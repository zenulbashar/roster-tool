import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses, users } from "@/lib/db/schema";
import {
  consumeXeroConnectInvite,
  createTenantRepo,
  type TenantRepo,
} from "@/lib/tenant/repository";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { generateToken } from "@/lib/tokens";

/**
 * Integration coverage of the Xero connection + delegated-invite persistence
 * against the real DB. The focus is the two pieces flagged for review before
 * the rest of the build lands:
 *   1. the CROSS-TENANT atomic invite consume — single-use, revoke-stops,
 *      expiry-stops, unknown-token-null, and race-safe (exactly one winner);
 *   2. the connection upsert/confirm gate — a (re)connect is always stored
 *      `pending_confirmation`, and only an owner confirm with the SHOWN tenant
 *      id activates it (so a push can never run against an unconfirmed org).
 * No Xero network calls here — this layer is pure DB; tokens arrive already
 * AES-256-GCM encrypted by the (future) service, mirroring Google Drive.
 */

const HOUR = 3_600_000;

describe("xero connection + delegated invite persistence", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let ownerA = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Xero Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Xero Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    const [owner] = await db
      .insert(users)
      .values({ email: "owner-a@xero.test" })
      .returning();
    ownerA = owner!.id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    if (ownerA) await db.delete(users).where(eq(users.id, ownerA));
    await db.$client.end();
  });

  /* ---- delegated invite: mint + atomic consume ------------------------- */

  it("consumes a valid invite exactly once and resolves its business", async () => {
    const { token, tokenHash } = generateToken();
    const invite = await repoA.createXeroConnectInvite({
      tokenHash,
      sentToEmail: "bookkeeper@acct.test",
      createdByUserId: ownerA,
      expiresAt: new Date(Date.now() + 48 * HOUR),
    });

    const won = await consumeXeroConnectInvite(token, {
      consumedIp: "203.0.113.9",
      consumedUserAgent: "Mozilla/5.0",
    });
    expect(won).not.toBeNull();
    expect(won!.id).toBe(invite.id);
    expect(won!.businessId).toBe(businessA); // business resolved FROM the invite
    expect(won!.consumedIp).toBe("203.0.113.9");
    expect(won!.consumedUserAgent).toBe("Mozilla/5.0");
    expect(won!.consumedAt).not.toBeNull();

    // Single-use: a second consume of the same token wins nothing.
    const again = await consumeXeroConnectInvite(token);
    expect(again).toBeNull();
  });

  it("won't consume a revoked invite", async () => {
    const { token, tokenHash } = generateToken();
    const invite = await repoA.createXeroConnectInvite({
      tokenHash,
      sentToEmail: "bk@acct.test",
      createdByUserId: ownerA,
      expiresAt: new Date(Date.now() + 48 * HOUR),
    });
    const revoked = await repoA.revokeXeroConnectInvite(invite.id);
    expect(revoked).not.toBeNull();
    expect(revoked!.revokedAt).not.toBeNull();

    expect(await consumeXeroConnectInvite(token)).toBeNull();
  });

  it("won't consume an expired invite", async () => {
    const { token, tokenHash } = generateToken();
    await repoA.createXeroConnectInvite({
      tokenHash,
      sentToEmail: "bk@acct.test",
      createdByUserId: ownerA,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    expect(await consumeXeroConnectInvite(token)).toBeNull();
  });

  it("returns null for an unknown token", async () => {
    expect(await consumeXeroConnectInvite("not-a-real-token")).toBeNull();
    expect(await consumeXeroConnectInvite("")).toBeNull();
  });

  it("is race-safe: exactly one of N concurrent consumes wins", async () => {
    const { token, tokenHash } = generateToken();
    await repoA.createXeroConnectInvite({
      tokenHash,
      sentToEmail: "bk@acct.test",
      createdByUserId: ownerA,
      expiresAt: new Date(Date.now() + 48 * HOUR),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeXeroConnectInvite(token)),
    );
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });

  it("revoke and list are tenant-scoped (no cross-business access)", async () => {
    const { tokenHash } = generateToken();
    const invite = await repoA.createXeroConnectInvite({
      tokenHash,
      sentToEmail: "bk@acct.test",
      createdByUserId: ownerA,
      expiresAt: new Date(Date.now() + 48 * HOUR),
    });
    // Business B can neither revoke nor see business A's invite.
    expect(await repoB.revokeXeroConnectInvite(invite.id)).toBeNull();
    const bList = await repoB.listXeroConnectInvites();
    expect(bList.find((r) => r.id === invite.id)).toBeUndefined();
  });

  /* ---- connection: upsert stays pending; confirm gates activation ------ */

  it("stores a (re)connect as pending_confirmation and gates push on confirm", async () => {
    const conn = await repoA.upsertXeroConnection({
      xeroTenantId: "tenant-abc",
      orgName: "Acme Pty Ltd",
      connectedAccountEmail: "bookkeeper@acct.test",
      accessTokenEnc: encryptSecret("access-1"),
      refreshTokenEnc: encryptSecret("refresh-1"),
      tokenExpiry: new Date(Date.now() + HOUR),
      authorisedScopes:
        "openid profile email offline_access payroll.timesheets",
      connectedViaInviteId: null,
      connectedIp: "203.0.113.9",
      connectedUserAgent: "UA",
    });
    expect(conn.status).toBe("pending_confirmation");
    expect(conn.confirmedByUserId).toBeNull();
    // Tokens are stored as ciphertext but round-trip to the plaintext.
    expect(conn.accessTokenEnc).not.toContain("access-1");
    expect(decryptSecret(conn.accessTokenEnc)).toBe("access-1");
    expect(decryptSecret(conn.refreshTokenEnc)).toBe("refresh-1");
    // The scopes we record must never include a pay-run scope.
    expect(conn.authorisedScopes).not.toContain("payrun");

    // Confirming with the WRONG tenant id must not activate anything.
    expect(
      await repoA.confirmXeroConnection({
        userId: ownerA,
        expectedTenantId: "tenant-WRONG",
      }),
    ).toBeNull();
    expect((await repoA.getXeroConnection())!.status).toBe(
      "pending_confirmation",
    );

    // Confirming with the shown tenant id activates it.
    const confirmed = await repoA.confirmXeroConnection({
      userId: ownerA,
      expectedTenantId: "tenant-abc",
    });
    expect(confirmed).not.toBeNull();
    expect(confirmed!.status).toBe("active");
    expect(confirmed!.confirmedByUserId).toBe(ownerA);
    expect(confirmed!.confirmedAt).not.toBeNull();
  });

  it("a reconnect resets an active connection back to pending_confirmation", async () => {
    // Business A is currently `active` from the previous test. Reconnect.
    const reconnected = await repoA.upsertXeroConnection({
      xeroTenantId: "tenant-abc",
      orgName: "Acme Pty Ltd",
      connectedAccountEmail: "bookkeeper@acct.test",
      accessTokenEnc: encryptSecret("access-2"),
      refreshTokenEnc: encryptSecret("refresh-2"),
      tokenExpiry: new Date(Date.now() + HOUR),
      authorisedScopes:
        "openid profile email offline_access payroll.timesheets",
      connectedViaInviteId: null,
      connectedIp: "203.0.113.9",
      connectedUserAgent: "UA",
    });
    expect(reconnected.status).toBe("pending_confirmation");
    expect(reconnected.confirmedByUserId).toBeNull();
    expect(reconnected.confirmedAt).toBeNull();
    expect(reconnected.needsReconnect).toBe(false);
    expect(decryptSecret(reconnected.accessTokenEnc)).toBe("access-2");
  });

  it("markXeroNeedsReconnect and delete work business-scoped", async () => {
    const flagged = await repoA.markXeroNeedsReconnect();
    expect(flagged!.needsReconnect).toBe(true);
    await repoA.deleteXeroConnection();
    expect(await repoA.getXeroConnection()).toBeNull();
  });
});
