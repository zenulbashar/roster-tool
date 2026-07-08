import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { TenantRepo } from "@/lib/tenant/repository";
import type { XeroClient, XeroTenant } from "./client";
import { XeroApiError, XeroReconnectRequired } from "./errors";
import { isTokenExpired } from "./tokens";

/**
 * Orchestration tying the tenant repo, the shared AES-256-GCM crypto, and a
 * `XeroClient` together. Kept free of env/route concerns and parameterised on
 * `XeroClient` so the whole flow is testable against a fake. Tokens live
 * encrypted in the DB; they are decrypted only here, in memory, immediately
 * before a Xero call, and are never returned to callers/clients or logged.
 *
 * Mirrors `google-drive/service.ts`, with two Xero-specific differences:
 *   1. the organisation (tenant) is resolved via GET /connections after auth;
 *   2. Xero ROTATES the refresh token on every refresh, so a refresh persists
 *      BOTH tokens (via `updateXeroTokens`).
 */

type XeroConnection = NonNullable<
  Awaited<ReturnType<TenantRepo["getXeroConnection"]>>
>;

/** Pick the organisation tenant to connect. We only support a single org per
 * business; if the token can act on several, the first ORGANISATION wins and
 * the owner confirms its name before the connection goes active (§ confirm). */
export function pickOrganisation(tenants: XeroTenant[]): XeroTenant | null {
  const orgs = tenants.filter(
    (t) => t.tenantType.toUpperCase() === "ORGANISATION",
  );
  return orgs[0] ?? tenants[0] ?? null;
}

/**
 * Finish an OAuth connect: exchange the code, resolve the org, and store the
 * encrypted tokens as a `pending_confirmation` connection (the owner confirms
 * the org name before it can push). Audit fields (invite id, IP, user agent)
 * are recorded when supplied (the delegated-link path). Returns what the owner
 * must confirm.
 */
export async function completeXeroConnection(opts: {
  repo: TenantRepo;
  client: XeroClient;
  code: string;
  connectedViaInviteId?: string | null;
  connectedIp?: string | null;
  connectedUserAgent?: string | null;
}): Promise<{ orgName: string; tenantId: string; email: string }> {
  const { repo, client, code } = opts;
  const tokens = await client.exchangeCode(code);
  const tenants = await client.getConnections(tokens.accessToken);
  const org = pickOrganisation(tenants);
  if (!org) {
    throw new XeroApiError("No Xero organisation available on this connection");
  }

  await repo.upsertXeroConnection({
    xeroTenantId: org.tenantId,
    orgName: org.tenantName,
    connectedAccountEmail: tokens.connectedEmail,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    tokenExpiry: tokens.expiry,
    authorisedScopes: tokens.scope || null,
    connectedViaInviteId: opts.connectedViaInviteId ?? null,
    connectedIp: opts.connectedIp ?? null,
    connectedUserAgent: opts.connectedUserAgent ?? null,
  });

  return {
    orgName: org.tenantName,
    tenantId: org.tenantId,
    email: tokens.connectedEmail,
  };
}

/**
 * Return a usable access token, refreshing first if it's expired. Persists the
 * rotated access AND refresh tokens; on a revoked/invalid refresh token, flags
 * the connection `needs_reconnect` and rethrows XeroReconnectRequired so the
 * caller can surface a reconnect prompt.
 */
export async function ensureFreshXeroAccessToken(opts: {
  repo: TenantRepo;
  client: XeroClient;
  connection: XeroConnection;
  now?: Date;
}): Promise<string> {
  const { repo, client, connection, now = new Date() } = opts;
  if (!isTokenExpired(connection.tokenExpiry, now)) {
    return decryptSecret(connection.accessTokenEnc);
  }
  const refreshToken = decryptSecret(connection.refreshTokenEnc);
  try {
    const refreshed = await client.refreshAccessToken(refreshToken);
    await repo.updateXeroTokens({
      accessTokenEnc: encryptSecret(refreshed.accessToken),
      refreshTokenEnc: encryptSecret(refreshed.refreshToken),
      tokenExpiry: refreshed.expiry,
    });
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof XeroReconnectRequired) {
      await repo.markXeroNeedsReconnect();
    }
    throw err;
  }
}
