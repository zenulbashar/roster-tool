/**
 * Friendly, non-technical messages for Auth.js error codes.
 *
 * When a sign-in fails (most commonly an expired or already-used magic link),
 * Auth.js redirects to our configured error page (`pages.error`) with the code
 * in the `?error=` query param. We route that to the main sign-in page and show
 * one of these messages above the email form, so the user can simply request a
 * fresh link instead of hitting a dead-end "Error" page.
 *
 * Codes: https://authjs.dev/reference/core/types#errortype
 */
export function signInErrorMessage(code?: string | null): string | null {
  switch (code) {
    case undefined:
    case null:
    case "":
      return null;
    case "Verification":
      // Expired or already-used magic link — the common case.
      return "That sign-in link has expired or was already used. Enter your email below and we'll send you a fresh one.";
    case "AccessDenied":
      return "You don't have access with that account. Enter your email below to try again.";
    case "sso":
      // A prompt2eat handoff (POST /api/sso/prompt2eat) couldn't be verified —
      // expired, replayed, or misconfigured. Never echo token contents; offer
      // the normal email sign-in instead.
      return "We couldn't sign you in from prompt2eat. Enter your email below and we'll send you a sign-in link.";
    default:
      // Configuration, Default, or anything unexpected.
      return "Something went wrong signing you in. Enter your email below to try again.";
  }
}
