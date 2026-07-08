/**
 * Typed errors for the Xero Payroll integration. Mirrors the Google Drive
 * error shapes so routes/services surface friendly prompts and never crash.
 */

/**
 * Thrown when the stored refresh token is no longer usable (revoked in Xero,
 * or otherwise `invalid_grant`). Callers catch this, flag the connection
 * `needs_reconnect`, and show the owner a "reconnect Xero" prompt — never crash.
 */
export class XeroReconnectRequired extends Error {
  constructor(message = "Xero needs to be reconnected") {
    super(message);
    this.name = "XeroReconnectRequired";
  }
}

/**
 * Thrown when the Xero feature isn't fully configured (missing OAuth env vars
 * or the shared token-encryption key). The connect flow checks
 * `isXeroConfigured()` up front and shows a message rather than letting this
 * surface — it exists as a guard so a token is never handled without encryption.
 */
export class XeroNotConfigured extends Error {
  constructor(message = "Xero integration is not configured") {
    super(message);
    this.name = "XeroNotConfigured";
  }
}

/**
 * Thrown when the Xero user who authorised the connection lacks payroll-admin
 * access (Xero returns a 403 on payroll calls). The owner-facing copy suggests
 * the delegated-bookkeeper fix.
 */
export class XeroPayrollAdminRequired extends Error {
  constructor(
    message = "This Xero connection needs to be approved by someone with payroll admin access. Ask your bookkeeper or accountant to complete this step if that's not you.",
  ) {
    super(message);
    this.name = "XeroPayrollAdminRequired";
  }
}

/**
 * Thrown by the (future) cancel path when a pushed timesheet is no longer a
 * DRAFT in Xero (a human has actioned it — APPROVED/PROCESSED). We refuse to
 * touch it and tell the owner it was already actioned in Xero.
 */
export class XeroTimesheetAlreadyActioned extends Error {
  constructor(
    message = "This timesheet has already been actioned in Xero and can no longer be changed from Roster.",
  ) {
    super(message);
    this.name = "XeroTimesheetAlreadyActioned";
  }
}

/** A non-specific Xero API failure (network/5xx/unexpected body). */
export class XeroApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "XeroApiError";
    this.status = status;
  }
}
