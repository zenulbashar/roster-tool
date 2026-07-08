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
  toXeroMsDate,
  XERO_CONNECTIONS_URL,
  XERO_PAYROLL_AU_BASE,
  XERO_TOKEN_URL,
} from "./tokens";

/**
 * Server-side ONLY Xero client, wrapped behind the `XeroClient` interface so
 * every network call is mockable (tests pass a fake). Tokens are passed in as
 * arguments (decrypted by the caller); this layer never touches the DB.
 *
 * BOUNDARY — this client is deliberately NARROW and uses raw `fetch`, NOT the
 * `xero-node` SDK, precisely so the codebase contains NO method that could
 * create or post a pay run, and NO method that writes employee bank / tax /
 * super details. The ONLY payroll WRITE is a DRAFT timesheet (Status is
 * hard-coded `"DRAFT"`; the input type has no status field, so a caller cannot
 * ask for anything else). Everything else here is read-only or OAuth plumbing.
 *
 * Deliberately absent (no method exists — not gated, not disabled): pay-run
 * create/post (`POST /PayRuns`), payslip mutation, employee create/update,
 * bank-account / tax-declaration / super writes, and approving a timesheet.
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

/** Inputs for a DRAFT timesheet. There is intentionally NO status field. */
export type XeroDraftTimesheetInput = {
  employeeId: string;
  /** Inclusive calendar dates (YYYY-MM-DD), aligned to the pay calendar. */
  startDate: string;
  endDate: string;
  earningsRateId: string;
  /** Hours per day across StartDate..EndDate inclusive (one entry per day). */
  numberOfUnits: number[];
};

export type XeroTimesheetResult = {
  timesheetId: string;
  /** Xero's status; we only ever create DRAFT, but reads may see others. */
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
  /** Create a DRAFT timesheet (Status hard-coded DRAFT). `idempotencyKey` is
   * sent as Xero's Idempotency-Key header. Returns the new timesheet id. */
  createDraftTimesheet(
    accessToken: string,
    tenantId: string,
    input: XeroDraftTimesheetInput,
    idempotencyKey: string,
  ): Promise<XeroTimesheetResult>;
  /** Read a timesheet's current id + status (to check it's still DRAFT). */
  getTimesheet(
    accessToken: string,
    tenantId: string,
    timesheetId: string,
  ): Promise<XeroTimesheetResult>;
  /** Update an existing DRAFT timesheet (Status stays DRAFT). Used by re-push
   * and by cancel-to-empty; both guard on the current status first. */
  updateDraftTimesheet(
    accessToken: string,
    tenantId: string,
    timesheetId: string,
    input: XeroDraftTimesheetInput,
    idempotencyKey: string,
  ): Promise<XeroTimesheetResult>;
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
    return postTimesheet({
      accessToken,
      tenantId,
      idempotencyKey,
      url: `${XERO_PAYROLL_AU_BASE}/Timesheets`,
      input,
    });
  },

  async getTimesheet(
    accessToken,
    tenantId,
    timesheetId,
  ): Promise<XeroTimesheetResult> {
    const res = await fetch(
      `${XERO_PAYROLL_AU_BASE}/Timesheets/${encodeURIComponent(timesheetId)}`,
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
    return firstTimesheet((await res.json()) as TimesheetEnvelope);
  },

  async updateDraftTimesheet(
    accessToken,
    tenantId,
    timesheetId,
    input,
    idempotencyKey,
  ): Promise<XeroTimesheetResult> {
    return postTimesheet({
      accessToken,
      tenantId,
      idempotencyKey,
      url: `${XERO_PAYROLL_AU_BASE}/Timesheets/${encodeURIComponent(timesheetId)}`,
      input,
    });
  },
};

type TimesheetEnvelope = {
  Timesheets?: Array<{ TimesheetID?: string; Status?: string }>;
};

/** Map a payroll HTTP error; a 403 most often means "not a payroll admin". */
function payrollError(status: number, action: string): Error {
  logger.error({ status, action }, "Xero payroll API error");
  // A 403 on a payroll call most often means the authorising Xero user is not a
  // payroll administrator — surface the delegated-bookkeeper fix.
  if (status === 403) {
    return new XeroPayrollAdminRequired();
  }
  return new XeroApiError(`Xero ${action} failed (${status})`, status);
}

function firstTimesheet(env_: TimesheetEnvelope): XeroTimesheetResult {
  const row = env_.Timesheets?.[0];
  if (!row?.TimesheetID) {
    throw new XeroApiError("Xero timesheet response missing TimesheetID");
  }
  return { timesheetId: row.TimesheetID, status: row.Status ?? "" };
}

/**
 * POST a timesheet (create or update). Status is HARD-CODED "DRAFT" here — the
 * one and only place a timesheet payload is built — so no caller can ever push
 * a non-draft timesheet. `NumberOfUnits` is the per-day array Xero expects.
 */
async function postTimesheet(opts: {
  accessToken: string;
  tenantId: string;
  idempotencyKey: string;
  url: string;
  input: XeroDraftTimesheetInput;
}): Promise<XeroTimesheetResult> {
  const body = {
    Timesheets: [
      {
        EmployeeID: opts.input.employeeId,
        StartDate: toXeroMsDate(opts.input.startDate),
        EndDate: toXeroMsDate(opts.input.endDate),
        Status: "DRAFT", // <-- the boundary, in code
        TimesheetLines: [
          {
            EarningsRateID: opts.input.earningsRateId,
            NumberOfUnits: opts.input.numberOfUnits,
          },
        ],
      },
    ],
  };
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Xero-Tenant-Id": opts.tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": opts.idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw payrollError(res.status, "postTimesheet");
  }
  return firstTimesheet((await res.json()) as TimesheetEnvelope);
}
