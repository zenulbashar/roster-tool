import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { TenantRepo } from "@/lib/tenant/repository";
import type { DriveClient } from "./client";
import { DriveReconnectRequired } from "./errors";
import { isTokenExpired, ROOT_FOLDER_NAME } from "./tokens";

/**
 * Orchestration that ties the tenant repo, the encryption helpers, and a
 * `DriveClient` together. Kept free of env/route concerns and parameterised on
 * `DriveClient` so the whole flow is testable against a fake Drive.
 *
 * Tokens live encrypted in the DB; they are decrypted only here, in memory,
 * immediately before a Drive call. They are never returned to callers/clients.
 */

type DriveConnection = NonNullable<
  Awaited<ReturnType<TenantRepo["getDriveConnection"]>>
>;

/**
 * Finish an OAuth connect: store encrypted tokens, record the account email,
 * and ensure a root folder exists (reusing the existing one on reconnect so we
 * don't orphan a folder or lose existing documents' home).
 */
export async function completeConnection(opts: {
  repo: TenantRepo;
  client: DriveClient;
  code: string;
}): Promise<{ email: string }> {
  const { repo, client, code } = opts;
  const tokens = await client.exchangeCode(code);
  const email = await client.getAccountEmail(tokens.accessToken);

  const existing = await repo.getDriveConnection();
  let rootFolderId = existing?.rootFolderId ?? null;
  if (!rootFolderId) {
    rootFolderId = await client.createFolder(
      tokens.accessToken,
      ROOT_FOLDER_NAME,
    );
  }

  await repo.upsertDriveConnection({
    googleAccountEmail: email,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    tokenExpiry: tokens.expiry,
    rootFolderId,
  });
  return { email };
}

/**
 * Return a usable access token, refreshing first if it's expired. Persists the
 * refreshed token; on a revoked/invalid refresh token, flags the connection
 * `needs_reconnect` and rethrows DriveReconnectRequired so the caller can
 * surface a reconnect prompt.
 */
export async function ensureFreshAccessToken(opts: {
  repo: TenantRepo;
  client: DriveClient;
  connection: DriveConnection;
  now?: Date;
}): Promise<string> {
  const { repo, client, connection, now = new Date() } = opts;
  if (!isTokenExpired(connection.tokenExpiry, now)) {
    return decryptSecret(connection.accessTokenEnc);
  }
  const refreshToken = decryptSecret(connection.refreshTokenEnc);
  try {
    const refreshed = await client.refreshAccessToken(refreshToken);
    await repo.updateDriveAccessToken({
      accessTokenEnc: encryptSecret(refreshed.accessToken),
      tokenExpiry: refreshed.expiry,
    });
    return refreshed.accessToken;
  } catch (err) {
    if (err instanceof DriveReconnectRequired) {
      await repo.markDriveNeedsReconnect();
    }
    throw err;
  }
}

/**
 * Upload bytes to the business's Drive folder and record a `staff_document`
 * reference. Throws DriveReconnectRequired when there's no usable connection.
 * The file bytes are never persisted in our DB and never logged.
 */
export async function uploadDocumentToDrive(opts: {
  repo: TenantRepo;
  client: DriveClient;
  staffMemberId: string;
  fileName: string;
  docType: string | null;
  mimeType: string;
  body: Buffer;
  now?: Date;
}) {
  const { repo, client, staffMemberId, fileName, docType, mimeType, body, now } =
    opts;
  const connection = await repo.getDriveConnection();
  if (!connection || connection.needsReconnect) {
    throw new DriveReconnectRequired();
  }
  const accessToken = await ensureFreshAccessToken({
    repo,
    client,
    connection,
    now,
  });

  let rootFolderId = connection.rootFolderId;
  if (!rootFolderId) {
    rootFolderId = await client.createFolder(accessToken, ROOT_FOLDER_NAME);
    await repo.setDriveRootFolder(rootFolderId);
  }

  const uploaded = await client.uploadFile(accessToken, {
    folderId: rootFolderId,
    name: fileName,
    mimeType,
    body,
  });

  return repo.addStaffDocument({
    staffMemberId,
    fileName,
    docType,
    driveFileId: uploaded.id,
    driveWebLink: uploaded.webViewLink,
    mimeType,
  });
}

/**
 * Remove a document: delete the file the app created in Drive (best-effort —
 * a reconnect-needed or Drive error never blocks), then remove our reference.
 * Returns whether the row was removed and whether the Drive file was deleted.
 */
export async function deleteDocument(opts: {
  repo: TenantRepo;
  client: DriveClient;
  documentId: string;
  now?: Date;
}): Promise<{ removed: boolean; driveDeleted: boolean }> {
  const { repo, client, documentId, now } = opts;
  const doc = await repo.getStaffDocument(documentId);
  if (!doc) return { removed: false, driveDeleted: false };

  let driveDeleted = false;
  const connection = await repo.getDriveConnection();
  if (connection && !connection.needsReconnect) {
    try {
      const accessToken = await ensureFreshAccessToken({
        repo,
        client,
        connection,
        now,
      });
      await client.deleteFile(accessToken, doc.driveFileId);
      driveDeleted = true;
    } catch (err) {
      // We still remove our reference so the owner isn't left with a dangling
      // row pointing at a file they can't manage from here.
      logger.warn({ err }, "Drive file delete failed; removing reference only");
    }
  }

  await repo.deleteStaffDocument(documentId);
  return { removed: true, driveDeleted };
}
