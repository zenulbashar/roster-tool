import { env } from "@/lib/env";
import { isEncryptionConfigured } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  XeroApiError,
  XeroNotConfigured,
  XeroPayrollAdminRequired,
  XeroReconnectRequired,
} from "./errors";
import {
  buildXeroAuthUrl,
  emailFromIdToken,
  scopesIncludePayrun,
  toXeroTimesheetDate,
  XERO_CONNECTIONS_URL,
  XERO_TIMESHEET_BASE_PATH,
  XERO_TOKEN_URL,
} from "./tokens";

/**
 * Server-side ONLY Xero client, wrapped behind the `XeroClient` interface so
 * every network call is mockable (tests pass a fake). Tokens are passed in as
 * arguments (decrypted by the caller); this layer never touches the DB.
 *
 * Timesheets use the **AU Payroll 2.0** surface (`payroll.xro/2.0`): ISO dates,
 * an explicit `payrollCalendarID`, one line PER DAY with a SCALAR
 * `numberOfUnits`, title-case `"Draft"`, and a real `DELETE`. The base path +
 * scope live in two isolated constants (`tokens.ts`) locked at first live
 * connect; every other wire detail is confirmed from the generated 2.0 models.
 *
 * BOUNDARY — this client is deliberately NARROW and uses raw `fetch`, NOT the
 * `xero-node` SDK, precisely so the codebase contains NO method that could:
 *   - create or post a PAY RUN (`POST /PayRuns`),
 *   - **APPROVE a timesheet (`POST /Timesheets/{id}/Approve`) or revert one
 *     (`.../RevertToDraft`)** — approving = finalising pay classification, a
 *     boundary breach, so on 2.0 these are excluded as deliberately as pay-runs,
 *   - or write employee bank / tax / super details.
 * The ONLY payroll WRITE is a DRAFT timesheet (`status` hard-coded `"Draft"`;
 * the input type has no status field, so a caller cannot ask for anything else)
 * and its DELETE while still Draft. A guard test asserts none of the excluded
 * methods exist on the client object.
 */

/** A full OAuth token set from Xero. NOTE: Xero ROTATES the refresh token on
 * every refresh, so callers must persist `refreshToken` after a refresh too. */
export type XeroTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  /** Space-separated granted scopes (stored + audited for no-payrun). */
  scope: string;
  /** Display-only account email, from the id_token; "" if absent. */
  connectedEmail: string;
};

/** One tenant (organisation) the token can act on, from GET /connections. */
export type XeroTenant = {
  tenantId: string;
  tenantType: string;
  tenantName: string;
};

/**
 * Inputs for a DRAFT timesheet (Payroll 2.0). There is intentionally NO status
 * field. A SINGLE `earningsRateId` applies to every line — structurally
 * enforcing the "single ordinary earnings rate" decision (penalty/overtime are
 * the human's job in Xero). `lines` is one entry PER WORKED DAY.
 */
export type XeroDraftTimesheetInput = {
  payrollCalendarId: string;
  employeeId: string;
  /** Inclusive period bounds (YYYY-MM-DD), aligned to the pay calendar. */
  startDate: string;
  endDate: string;
  earningsRateId: string;
  /** Hours per worked day: { date: YYYY-MM-DD, numberOfUnits: hours }. */
  lines: Array<{ date: string; numberOfUnits: number }>;
};

export type XeroTimesheetResult = {
  timesheetId: string;
  /** Xero's status; we only ever create Draft, but reads may see others. */
  status: string;
};

export interface XeroClient {
  /** Consent URL for the (owner or delegated bookkeeper) to authorise. */
  buildAuthUrl(state: string): string;
  /** Exchange an authorization code for a token set (incl. refresh token). */
  exchangeCode(code: string): Promise<XeroTokenSet>;
  /** Refresh; throws XeroReconnectRequired on invalid_grant. Returns the NEW
   * access AND refresh tokens (Xero rotates the refresh token). */
  refreshAccessToken(refreshToken: string): Promise<XeroTokenSet>;
  /** Organisations the token can act on (to pick the Xero-Tenant-Id + name). */
  getConnections(accessToken: string): Promise<XeroTenant[]>;
  /** Create a DRAFT timesheet (status hard-coded Draft). `idempotencyKey` is
   * sent as Xero's Idempotency-Key header. Returns the new timesheet id. */
  createDraftTimesheet(
    accessToken: string,
    tenantId: string,
    input: XeroDraftTimesheetInput,
    idempotencyKey: string,
  ): Promise<XeroTimesheetResult>;
  /** Read a timesheet's current id + status (to check it's still Draft). */
  getTimesheet(
    accessToken: string,
    tenantId: string,
    timesheetId: string,
  ): Promise<XeroTimesheetResult>;
  /** Delete a timesheet (the real cancel). The caller guards that it's still
   * Draft first; a 404 is treated as already-gone (success). */
  deleteTimesheet(
    accessToken: string,
    tenantId: string,
    timesheetId: string,
  ): Promise<void>;
}

/** Whether OAuth env vars AND the shared encryption key are all present. */
export function isXeroConfigured(): boolean {
  return Boolean(
    env.XERO_CLIENT_ID &&
    env.XERO_CLIENT_SECRET &&
    env.XERO_OAUTH_REDIRECT_URI &&
    isEncryptionConfigured(),
  );
}

function requireConfig() {
  if (
    !env.XERO_CLIENT_ID ||
    !env.XERO_CLIENT_SECRET ||
    !env.XERO_OAUTH_REDIRECT_URI
  ) {
    throw new XeroNotConfigured();
  }
  return {
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
    redirectUri: env.XERO_OAUTH_REDIRECT_URI,
  };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

type XeroTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
};

/** Parse a token endpoint response into our set, rejecting a pay-run scope. */
function parseTokenResponse(data: XeroTokenResponse): XeroTokenSet {
  if (!data.access_token || !data.refresh_token) {
    throw new XeroApiError("Xero token response missing tokens");
  }
  const scope = data.scope ?? "";
  if (scopesIncludePayrun(scope)) {
    // Defence in depth: we never request it, but never accept it either.
    throw new XeroApiError("Xero returned a pay-run scope; refusing to store");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiry: new Date(Date.now() + (data.expires_in ?? 1800) * 1000),
    scope,
    connectedEmail: emailFromIdToken(data.id_token),
  };
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/** Map a payroll HTTP error; a 403 most often means "not a payroll admin". */
function payrollError(status: number, action: string): Error {
  logger.error({ status, action }, "Xero payroll API error");
  if (status === 403) {
    return new XeroPayrollAdminRequired();
  }
  return new XeroApiError(`Xero ${action} failed (${status})`, status);
}

/** Payroll 2.0 wraps a single timesheet under `timesheet`. */
type TimesheetEnvelope = {
  timesheet?: { timesheetID?: string; status?: string };
};

function parseTimesheet(data: TimesheetEnvelope): XeroTimesheetResult {
  const ts = data.timesheet;
  if (!ts?.timesheetID) {
    throw new XeroApiError("Xero timesheet response missing timesheetID");
  }
  return { timesheetId: ts.timesheetID, status: ts.status ?? "" };
}

export const xeroClient: XeroClient = {
  buildAuthUrl(state: string): string {
    const { clientId, redirectUri } = requireConfig();
    return buildXeroAuthUrl({ clientId, redirectUri, state });
  },

  async exchangeCode(code: string): Promise<XeroTokenSet> {
    const { clientId, clientSecret, redirectUri } = requireConfig();
    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      await readErrorBody(res); // drain; never log token/body contents verbatim
      logger.error(
        { status: res.status, action: "exchangeCode" },
        "Xero token error",
      );
      throw new XeroApiError(
        `Xero token exchange failed (${res.status})`,
        res.status,
      );
    }
    return parseTokenResponse((await res.json()) as XeroTokenResponse);
  },

  async refreshAccessToken(refreshToken: string): Promise<XeroTokenSet> {
    const { clientId, clientSecret } = requireConfig();
    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(clientId, clientSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      if (res.status === 400 && body.includes("invalid_grant")) {
        throw new XeroReconnectRequired();
      }
      logger.error(
        { status: res.status, action: "refresh" },
        "Xero refresh error",
      );
      throw new XeroApiError(
        `Xero token refresh failed (${res.status})`,
        res.status,
      );
    }
    return parseTokenResponse((await res.json()) as XeroTokenResponse);
  },

  async getConnections(accessToken: string): Promise<XeroTenant[]> {
    const res = await fetch(XERO_CONNECTIONS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      logger.error(
        { status: res.status, action: "connections" },
        "Xero connections error",
      );
      throw new XeroApiError(
        `Xero connections failed (${res.status})`,
        res.status,
      );
    }
    const rows = (await res.json()) as Array<{
      tenantId?: string;
      tenantType?: string;
      tenantName?: string;
    }>;
    return rows
      .filter((r) => r.tenantId)
      .map((r) => ({
        tenantId: r.tenantId!,
        tenantType: r.tenantType ?? "",
        tenantName: r.tenantName ?? "",
      }));
  },

  async createDraftTimesheet(
    accessToken,
    tenantId,
    input,
    idempotencyKey,
  ): Promise<XeroTimesheetResult> {
    // The ONE place a timesheet payload is built. `status` is hard-coded
    // "Draft" and there is no input path to any other status.
    const body = {
      payrollCalendarID: input.payrollCalendarId,
      employeeID: input.employeeId,
      startDate: toXeroTimesheetDate(input.startDate),
      endDate: toXeroTimesheetDate(input.endDate),
      status: "Draft", // <-- the boundary, in code
      timesheetLines: input.lines.map((l) => ({
        date: toXeroTimesheetDate(l.date),
        earningsRateID: input.earningsRateId, // single ordinary rate for all lines
        numberOfUnits: l.numberOfUnits,
      })),
    };
    const res = await fetch(`${XERO_TIMESHEET_BASE_PATH}/Timesheets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-Tenant-Id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw payrollError(res.status, "createDraftTimesheet");
    }
    return parseTimesheet((await res.json()) as TimesheetEnvelope);
  },

  async getTimesheet(
    accessToken,
    tenantId,
    timesheetId,
  ): Promise<XeroTimesheetResult> {
    const res = await fetch(
      `${XERO_TIMESHEET_BASE_PATH}/Timesheets/${encodeURIComponent(timesheetId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": tenantId,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw payrollError(res.status, "getTimesheet");
    }
    return parseTimesheet((await res.json()) as TimesheetEnvelope);
  },

  async deleteTimesheet(accessToken, tenantId, timesheetId): Promise<void> {
    const res = await fetch(
      `${XERO_TIMESHEET_BASE_PATH}/Timesheets/${encodeURIComponent(timesheetId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-Tenant-Id": tenantId,
          Accept: "application/json",
        },
      },
    );
    // 404 = already gone in Xero; treat as success so our row can be cancelled.
    if (!res.ok && res.status !== 404) {
      throw payrollError(res.status, "deleteTimesheet");
    }
  },
};
