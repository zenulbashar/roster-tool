import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { createTenantRepo, type TenantRepo } from "@/lib/tenant/repository";
import { decryptSecret } from "@/lib/crypto";
import type { DriveClient, DriveTokens } from "@/lib/google-drive/client";
import { DriveReconnectRequired } from "@/lib/google-drive/errors";
import {
  completeConnection,
  deleteDocument,
  uploadDocumentToDrive,
} from "@/lib/google-drive/service";

/**
 * Integration coverage of the Google Drive connection + documents against the
 * real DB, driving the service layer with a FAKE DriveClient (the OAuth/Drive
 * network calls are wrapped behind the interface). Asserts: connect stores
 * encrypted tokens + creates a folder; upload records a staff_document with the
 * returned ids; an expired token triggers a refresh; a revoked refresh surfaces
 * reconnect; and one business can't see another's connection or documents.
 */

class FakeDriveClient implements DriveClient {
  calls = {
    exchangeCode: 0,
    createFolder: 0,
    uploadFile: 0,
    deleteFile: 0,
    refreshAccessToken: 0,
    revoke: 0,
  };
  deletedFileIds: string[] = [];
  refreshShouldRevoke = false;
  private folderSeq = 0;
  private fileSeq = 0;

  buildAuthUrl(state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
  }
  async exchangeCode(): Promise<DriveTokens> {
    this.calls.exchangeCode++;
    return {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiry: new Date(Date.now() + 3_600_000),
    };
  }
  async refreshAccessToken(): Promise<{ accessToken: string; expiry: Date }> {
    this.calls.refreshAccessToken++;
    if (this.refreshShouldRevoke) throw new DriveReconnectRequired();
    return {
      accessToken: "access-refreshed",
      expiry: new Date(Date.now() + 3_600_000),
    };
  }
  async getAccountEmail(): Promise<string> {
    return "owner@gmail.com";
  }
  async createFolder(): Promise<string> {
    this.calls.createFolder++;
    return `folder-${++this.folderSeq}`;
  }
  async uploadFile(): Promise<{ id: string; webViewLink: string }> {
    this.calls.uploadFile++;
    const id = `file-${++this.fileSeq}`;
    return { id, webViewLink: `https://drive.google.com/file/d/${id}/view` };
  }
  async deleteFile(_accessToken: string, fileId: string): Promise<void> {
    this.calls.deleteFile++;
    this.deletedFileIds.push(fileId);
  }
  async revoke(): Promise<void> {
    this.calls.revoke++;
  }
}

describe("google drive connection + documents", () => {
  let businessA = "";
  let businessB = "";
  let repoA: TenantRepo;
  let repoB: TenantRepo;
  let staffA = "";

  beforeAll(async () => {
    const [a] = await db
      .insert(businesses)
      .values({ name: "Drive Café A" })
      .returning();
    const [b] = await db
      .insert(businesses)
      .values({ name: "Drive Café B" })
      .returning();
    businessA = a!.id;
    businessB = b!.id;
    repoA = createTenantRepo(businessA);
    repoB = createTenantRepo(businessB);
    staffA = (await repoA.addStaff({ name: "Ava", email: "ava@a.test" })).id;
  });

  afterAll(async () => {
    if (businessA)
      await db.delete(businesses).where(eq(businesses.id, businessA));
    if (businessB)
      await db.delete(businesses).where(eq(businesses.id, businessB));
    await db.$client.end();
  });

  it("connect stores ENCRYPTED tokens + creates a root folder", async () => {
    const client = new FakeDriveClient();
    const { email } = await completeConnection({
      repo: repoA,
      client,
      code: "auth-code",
    });
    expect(email).toBe("owner@gmail.com");
    expect(client.calls.createFolder).toBe(1);

    const conn = await repoA.getDriveConnection();
    expect(conn).not.toBeNull();
    expect(conn!.googleAccountEmail).toBe("owner@gmail.com");
    expect(conn!.rootFolderId).toBe("folder-1");
    expect(conn!.needsReconnect).toBe(false);
    // Stored ciphertext is NOT the plaintext token, but decrypts back to it.
    expect(conn!.accessTokenEnc).not.toContain("access-1");
    expect(decryptSecret(conn!.accessTokenEnc)).toBe("access-1");
    expect(decryptSecret(conn!.refreshTokenEnc)).toBe("refresh-1");
  });

  it("reconnect reuses the existing folder (no second folder created)", async () => {
    const client = new FakeDriveClient();
    await completeConnection({ repo: repoA, client, code: "auth-code-2" });
    expect(client.calls.createFolder).toBe(0); // reused folder-1
    const conn = await repoA.getDriveConnection();
    expect(conn!.rootFolderId).toBe("folder-1");
  });

  it("upload records a staff_document with the returned Drive ids", async () => {
    const client = new FakeDriveClient();
    const doc = await uploadDocumentToDrive({
      repo: repoA,
      client,
      staffMemberId: staffA,
      fileName: "contract.pdf",
      docType: "Contract",
      mimeType: "application/pdf",
      body: Buffer.from("pretend-pdf-bytes"),
    });
    expect(client.calls.uploadFile).toBe(1);
    expect(doc.driveFileId).toBe("file-1");
    expect(doc.driveWebLink).toContain("file-1");

    const list = await repoA.listStaffDocuments(staffA);
    expect(list.map((d) => d.id)).toContain(doc.id);
    expect(list[0]!.fileName).toBe("contract.pdf");
    expect(list[0]!.docType).toBe("Contract");
  });

  it("refreshes an expired access token before uploading + persists it", async () => {
    // Force the stored token to look expired.
    await db
      .update((await import("@/lib/db/schema")).googleDriveConnections)
      .set({ tokenExpiry: new Date(Date.now() - 60_000) })
      .where(
        eq(
          (await import("@/lib/db/schema")).googleDriveConnections.businessId,
          businessA,
        ),
      );
    const client = new FakeDriveClient();
    await uploadDocumentToDrive({
      repo: repoA,
      client,
      staffMemberId: staffA,
      fileName: "id.png",
      docType: "ID",
      mimeType: "image/png",
      body: Buffer.from("img"),
    });
    expect(client.calls.refreshAccessToken).toBe(1);
    const conn = await repoA.getDriveConnection();
    expect(decryptSecret(conn!.accessTokenEnc)).toBe("access-refreshed");
    expect(conn!.tokenExpiry.getTime()).toBeGreaterThan(Date.now());
  });

  it("a revoked refresh token surfaces reconnect (flag set, error thrown)", async () => {
    await db
      .update((await import("@/lib/db/schema")).googleDriveConnections)
      .set({ tokenExpiry: new Date(Date.now() - 60_000) })
      .where(
        eq(
          (await import("@/lib/db/schema")).googleDriveConnections.businessId,
          businessA,
        ),
      );
    const client = new FakeDriveClient();
    client.refreshShouldRevoke = true;
    await expect(
      uploadDocumentToDrive({
        repo: repoA,
        client,
        staffMemberId: staffA,
        fileName: "x.pdf",
        docType: null,
        mimeType: "application/pdf",
        body: Buffer.from("x"),
      }),
    ).rejects.toBeInstanceOf(DriveReconnectRequired);
    const conn = await repoA.getDriveConnection();
    expect(conn!.needsReconnect).toBe(true);
  });

  it("upload throws reconnect when the connection needs reconnect", async () => {
    // Still flagged from the previous test.
    const client = new FakeDriveClient();
    await expect(
      uploadDocumentToDrive({
        repo: repoA,
        client,
        staffMemberId: staffA,
        fileName: "y.pdf",
        docType: null,
        mimeType: "application/pdf",
        body: Buffer.from("y"),
      }),
    ).rejects.toBeInstanceOf(DriveReconnectRequired);
    expect(client.calls.uploadFile).toBe(0);
  });

  it("isolates connections and documents across tenants", async () => {
    // B has no connection even though A does.
    expect(await repoB.getDriveConnection()).toBeNull();

    // B can't see A's documents, and deleting A's doc id from B is a no-op.
    const aDocs = await repoA.listStaffDocuments(staffA);
    const aDocId = aDocs[0]!.id;
    expect(await repoB.getStaffDocument(aDocId)).toBeNull();
    expect(await repoB.deleteStaffDocument(aDocId)).toBeNull();
    // A still has it.
    expect(await repoA.getStaffDocument(aDocId)).not.toBeNull();
  });

  it("delete removes the row AND deletes the Drive file", async () => {
    // Clear the reconnect flag so the Drive delete is attempted.
    const client = new FakeDriveClient();
    await completeConnection({ repo: repoA, client, code: "reconnect" });
    const fresh = await uploadDocumentToDrive({
      repo: repoA,
      client,
      staffMemberId: staffA,
      fileName: "del.pdf",
      docType: null,
      mimeType: "application/pdf",
      body: Buffer.from("z"),
    });
    const result = await deleteDocument({
      repo: repoA,
      client,
      documentId: fresh.id,
    });
    expect(result).toEqual({ removed: true, driveDeleted: true });
    expect(client.deletedFileIds).toContain(fresh.driveFileId);
    expect(await repoA.getStaffDocument(fresh.id)).toBeNull();
  });

  it("disconnect forgets the tokens", async () => {
    await repoA.deleteDriveConnection();
    expect(await repoA.getDriveConnection()).toBeNull();
  });
});
