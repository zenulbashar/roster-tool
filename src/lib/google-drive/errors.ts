/**
 * Thrown when the stored refresh token is no longer usable (revoked by the
 * owner in their Google account, or otherwise `invalid_grant`). Callers catch
 * this, flag the connection `needs_reconnect`, and show the owner a clear
 * "reconnect Google Drive" prompt — they must NEVER crash the request.
 */
export class DriveReconnectRequired extends Error {
  constructor(message = "Google Drive needs to be reconnected") {
    super(message);
    this.name = "DriveReconnectRequired";
  }
}

/**
 * Thrown when the Drive feature isn't fully configured (missing OAuth env vars
 * or the token-encryption key). The connect flow checks `isDriveConfigured()`
 * up front and shows the owner/operator a message rather than letting this
 * surface — it exists as a guard so a token is never handled without
 * encryption.
 */
export class DriveNotConfigured extends Error {
  constructor(message = "Google Drive integration is not configured") {
    super(message);
    this.name = "DriveNotConfigured";
  }
}
