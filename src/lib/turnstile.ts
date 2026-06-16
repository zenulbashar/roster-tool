import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Server-side Cloudflare Turnstile verification for the public form route.
 *
 * FAILS CLOSED: if the secret key is not configured we reject every submission
 * (and log a warning) rather than letting spam through — set both Turnstile
 * keys in the environment before publishing forms. Absent/invalid tokens are
 * rejected too. Never throws; returns a boolean so the submit path branches
 * cleanly. IP limiting is best-effort, so remoteip is optional.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail closed. This is a misconfiguration in production; surface it loudly.
    logger.warn(
      "TURNSTILE_SECRET_KEY is not set — rejecting public form submission (fail closed). Set both Turnstile keys before publishing forms.",
    );
    return false;
  }
  if (!token) return false;

  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Turnstile siteverify HTTP error");
      return false;
    }
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    logger.warn({ err }, "Turnstile siteverify request failed");
    return false;
  }
}
