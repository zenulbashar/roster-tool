/**
 * Pure OAuth/token/scope helpers for Xero — no I/O, no env, no SDK. Kept
 * separate from the client so they're trivially unit-testable.
 */

/**
 * The scopes Roster requests. Read/timesheet-write ONLY — deliberately NEVER
 * `payroll.payruns` (the app has no pay-run capability at all). `offline_access`
 * yields a refresh token; `openid email` populate the id_token's email claim we
 * store for display. Xero mandated GRANULAR scopes for apps created after
 * 2 March 2026 (the old bundled `payroll` scope is retired), so there is no
 * bundled-scope path that could smuggle in pay-run access.
 */
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "payroll.timesheets",
  "payroll.employees.read",
  "payroll.settings.read",
] as const;

export const XERO_SCOPE_STRING = XERO_SCOPES.join(" ");

/** Xero OAuth 2.0 endpoints (well-known, stable). */
export const XERO_AUTHORIZE_URL =
  "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
/** AU Payroll 1.0 base — Accounting is api.xro/2.0; these never overlap. */
export const XERO_PAYROLL_AU_BASE = "https://api.xero.com/payroll.xro/1.0";

/**
 * A hard guard: no scope Roster ever requests or accepts may grant pay-run
 * access. Used both when building the auth URL and when recording the granted
 * scopes, so a misconfiguration can't silently widen our authority. Matches
 * `payroll.payruns` in any case, with or without a `.read`/`.write` suffix.
 */
export function scopesIncludePayrun(scope: string): boolean {
  return /payroll\.payruns/i.test(scope);
}

/**
 * Whether the access token should be refreshed before the next Xero call. A
 * `skewSeconds` margin (default 60s) refreshes slightly early so a token never
 * expires mid-request. Mirrors the Drive helper.
 */
export function isTokenExpired(
  expiry: Date,
  now: Date = new Date(),
  skewSeconds = 60,
): boolean {
  return now.getTime() >= expiry.getTime() - skewSeconds * 1000;
}

/**
 * Build the Xero OAuth consent URL. `state` is the CSRF nonce checked on
 * callback. We assert the scope never includes a pay-run scope — a belt-and-
 * braces guard alongside the fixed `XERO_SCOPES` list.
 */
export function buildXeroAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  if (scopesIncludePayrun(XERO_SCOPE_STRING)) {
    // Unreachable given the fixed list, but fail loudly if that ever changes.
    throw new Error("Refusing to build a Xero auth URL with a pay-run scope");
  }
  const url = new URL(XERO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", XERO_SCOPE_STRING);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Extract the `email` claim from an OpenID Connect id_token (a JWT). We only
 * READ the payload for a DISPLAY-only "connected account email" — this is not
 * an authorization decision, so we decode (not verify) the middle segment.
 * Returns "" if the token is malformed or has no email claim.
 */
export function emailFromIdToken(idToken: string | undefined | null): string {
  if (!idToken) return "";
  const parts = idToken.split(".");
  if (parts.length < 2) return "";
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : "";
  } catch {
    return "";
  }
}

/**
 * Serialise a calendar date (YYYY-MM-DD, treated as a UTC wall date) into
 * Xero's proprietary MS-JSON date format `"/Date(<epoch-ms>)/"`. AU Payroll 1.0
 * uses this, not ISO. Timesheet StartDate/EndDate go through here.
 */
export function toXeroMsDate(isoDate: string): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date for Xero serialisation: ${isoDate}`);
  }
  return `/Date(${ms})/`;
}
