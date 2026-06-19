import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";
import { isEncryptionConfigured } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { DriveNotConfigured, DriveReconnectRequired } from "./errors";
import { buildGoogleAuthUrl, ROOT_FOLDER_NAME } from "./tokens";

/**
 * Server-side ONLY Google Drive client. Wrapped behind the `DriveClient`
 * interface so the OAuth/Drive network calls are mockable: every higher-level
 * service takes a `DriveClient` and tests pass a fake. Tokens are passed in as
 * arguments (decrypted by the caller); this layer never touches the DB.
 */

export type DriveTokens = {
  accessToken: string;
  refreshToken: string;
  /** Access-token expiry. */
  expiry: Date;
};

export type UploadResult = { id: string; webViewLink: string };

export interface DriveClient {
  /** Consent URL for the owner to grant drive.file access. */
  buildAuthUrl(state: string): string;
  /** Exchange an authorization code for tokens (incl. a refresh token). */
  exchangeCode(code: string): Promise<DriveTokens>;
  /** Refresh an access token; throws DriveReconnectRequired on invalid_grant. */
  refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiry: Date }>;
  /** The connected Google account's email (via drive.file `about.get`). */
  getAccountEmail(accessToken: string): Promise<string>;
  /** Create a folder, returning its Drive id. */
  createFolder(accessToken: string, name: string): Promise<string>;
  /** Upload bytes into a folder, returning the new file's id + web link. */
  uploadFile(
    accessToken: string,
    params: {
      folderId: string;
      name: string;
      mimeType: string;
      body: Buffer;
    },
  ): Promise<UploadResult>;
  /** Delete a file the app created. */
  deleteFile(accessToken: string, fileId: string): Promise<void>;
  /** Best-effort token revocation (on disconnect). Never throws. */
  revoke(token: string): Promise<void>;
}

/** Whether OAuth env vars AND the encryption key are all present. */
export function isDriveConfigured(): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REDIRECT_URI &&
    isEncryptionConfigured(),
  );
}

function requireConfig() {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_OAUTH_REDIRECT_URI
  ) {
    throw new DriveNotConfigured();
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  };
}

function looksLikeInvalidGrant(err: unknown): boolean {
  // google-auth-library throws a GaxiosError carrying the OAuth error code.
  const e = err as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  return (
    e?.response?.data?.error === "invalid_grant" ||
    (typeof e?.message === "string" && e.message.includes("invalid_grant"))
  );
}

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";
const DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about?fields=user";

async function driveError(res: Response, action: string): Promise<never> {
  // Read a short error body for logs WITHOUT logging tokens or file content.
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  logger.error({ status: res.status, action }, "Google Drive API error");
  throw new Error(`Drive ${action} failed (${res.status}): ${detail}`);
}

/** Build a multipart/related body for a Drive upload (metadata + media). */
function buildMultipartBody(
  metadata: object,
  mimeType: string,
  body: Buffer,
): { boundary: string; payload: Buffer } {
  const boundary = `roster-${randomBytes(12).toString("hex")}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return { boundary, payload: Buffer.concat([head, body, tail]) };
}

export const googleDriveClient: DriveClient = {
  buildAuthUrl(state: string): string {
    const { clientId, redirectUri } = requireConfig();
    return buildGoogleAuthUrl({ clientId, redirectUri, state });
  },

  async exchangeCode(code: string): Promise<DriveTokens> {
    const { clientId, clientSecret, redirectUri } = requireConfig();
    const oauth = new OAuth2Client({ clientId, clientSecret, redirectUri });
    const { tokens } = await oauth.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      // No refresh token means we can't keep access long-term; force reconnect
      // with consent (we always request prompt=consent, so this is rare).
      throw new Error("Google did not return a refresh token");
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiry: new Date(tokens.expiry_date ?? Date.now() + 3_600_000),
    };
  },

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiry: Date }> {
    const { clientId, clientSecret } = requireConfig();
    const oauth = new OAuth2Client({ clientId, clientSecret });
    oauth.setCredentials({ refresh_token: refreshToken });
    try {
      await oauth.getAccessToken(); // triggers refresh, populates credentials
      const creds = oauth.credentials;
      if (!creds.access_token) {
        throw new Error("No access token after refresh");
      }
      return {
        accessToken: creds.access_token,
        expiry: new Date(creds.expiry_date ?? Date.now() + 3_600_000),
      };
    } catch (err) {
      if (looksLikeInvalidGrant(err)) {
        throw new DriveReconnectRequired();
      }
      throw err;
    }
  },

  async getAccountEmail(accessToken: string): Promise<string> {
    const res = await fetch(DRIVE_ABOUT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) await driveError(res, "about.get");
    const data = (await res.json()) as { user?: { emailAddress?: string } };
    return data.user?.emailAddress ?? "";
  },

  async createFolder(accessToken: string, name: string): Promise<string> {
    const res = await fetch(`${DRIVE_FILES}?fields=id`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
    if (!res.ok) await driveError(res, "createFolder");
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error("Drive createFolder returned no id");
    return data.id;
  },

  async uploadFile(
    accessToken: string,
    params: {
      folderId: string;
      name: string;
      mimeType: string;
      body: Buffer;
    },
  ): Promise<UploadResult> {
    const { boundary, payload } = buildMultipartBody(
      { name: params.name, parents: [params.folderId] },
      params.mimeType,
      params.body,
    );
    const res = await fetch(DRIVE_UPLOAD, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      // Copy into a plain Uint8Array — the global fetch BodyInit type doesn't
      // accept a Node Buffer directly.
      body: new Uint8Array(payload),
    });
    if (!res.ok) await driveError(res, "uploadFile");
    const data = (await res.json()) as { id?: string; webViewLink?: string };
    if (!data.id) throw new Error("Drive uploadFile returned no id");
    return {
      id: data.id,
      webViewLink:
        data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    };
  },

  async deleteFile(accessToken: string, fileId: string): Promise<void> {
    const res = await fetch(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 = already gone in Drive; treat as success so our row can be removed.
    if (!res.ok && res.status !== 404) await driveError(res, "deleteFile");
  },

  async revoke(token: string): Promise<void> {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
    } catch (err) {
      // Best-effort: the owner is disconnecting anyway; never block on this.
      logger.warn({ err }, "Google token revoke failed (ignored)");
    }
  },
};

export { ROOT_FOLDER_NAME };
