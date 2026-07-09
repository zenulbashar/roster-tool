/** Shared constants for the Xero OAuth CSRF-state cookie (mirrors the Google
 * Drive integration). The cookie is httpOnly + path-scoped to the Xero routes. */
export const XERO_OAUTH_STATE_COOKIE = "xero_oauth_state";
export const XERO_OAUTH_COOKIE_PATH = "/api/integrations/xero";
/**
 * Carries the delegated bookkeeper invite's RAW token THROUGH the OAuth flow so
 * it is consumed atomically in the callback (never on link-click, which a mail
 * client could prefetch). Present ⇒ delegated mode (no owner session); absent ⇒
 * the owner connected it themselves.
 */
export const XERO_INVITE_TOKEN_COOKIE = "xero_invite_token";
