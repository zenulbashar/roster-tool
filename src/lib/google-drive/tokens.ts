/**
 * Pure OAuth/token helpers — no I/O, no env, no library. Kept separate from the
 * Drive client so they're trivially unit-testable.
 */

/** The ONLY scope we ever request: per-file access to files the app creates. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** The Drive folder the app creates per business to hold uploaded documents. */
export const ROOT_FOLDER_NAME = "Roster Documents";

/**
 * Whether the access token should be treated as expired and refreshed before
 * the next Drive call. A `skewSeconds` margin (default 60s) refreshes slightly
 * early so a token never expires mid-request.
 */
export function isTokenExpired(
  expiry: Date,
  now: Date = new Date(),
  skewSeconds = 60,
): boolean {
  return now.getTime() >= expiry.getTime() - skewSeconds * 1000;
}

/**
 * Build the Google OAuth consent URL. drive.file scope only; `offline` +
 * `prompt=consent` so Google always returns a refresh token (it otherwise
 * omits it on re-consent). `state` is the CSRF nonce checked on callback.
 */
export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}
