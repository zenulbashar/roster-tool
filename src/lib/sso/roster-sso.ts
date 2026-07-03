import {
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Inbound SSO from prompt2eat — token verification.
 *
 * prompt2eat mints a compact JWS (`header.payload.signature`, all base64url,
 * EdDSA / Ed25519) and POSTs it to `POST /api/sso/prompt2eat`. This module
 * turns that raw token into verified claims (or a rejection reason). It holds
 * ONLY the public key, so Roster can verify a token but never mint one — a
 * Roster compromise cannot forge a prompt2eat-trusted handoff.
 *
 * The claim-validation logic (`validateHandoffClaims`) is pure and key-free so
 * it can be unit-tested exhaustively; `verifyHandoffTokenWithKey` layers the
 * signature check on top for tests that inject a keypair; and
 * `verifyRosterHandoffToken` wires in the env-pinned public key for the route.
 */

export const SSO_ISSUER = "prompt2eat";
export const SSO_AUDIENCE = "roster";

/** Clock-skew allowance on `exp`/`iat` (seconds). Spec: ≤30s. */
export const CLOCK_SKEW_SECONDS = 30;

/** Maximum accepted token lifetime (`exp - iat`, seconds). Spec: exp = iat + 60. */
export const MAX_TOKEN_LIFETIME_SECONDS = 60;

const venueSchema = z.object({
  id: z.string().nullish(),
  slug: z.string().nullish(),
  name: z.string().nullish(),
});

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  iat: z.number(),
  exp: z.number(),
  jti: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullish(),
  // Context only — display/prefill. Per decision D5 this is NEVER an org key.
  venue: venueSchema.nullish(),
  entitlements: z.object({ roster: z.boolean() }).nullish(),
});

export type RosterHandoffClaims = z.infer<typeof claimsSchema>;

const headerSchema = z.object({
  alg: z.string(),
  typ: z.string().optional(),
});

export type VerifyResult =
  | { ok: true; claims: RosterHandoffClaims }
  | { ok: false; reason: string };

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/**
 * Validate a decoded header + payload against the contract, key-free and pure.
 * Checks the signing algorithm, the claim shape, issuer/audience, expiry (with
 * skew), a non-future `iat`, and the ≤60s lifetime bound. Never trusts a
 * payload whose signature hasn't already been verified by the caller.
 */
export function validateHandoffClaims(
  header: unknown,
  payload: unknown,
  nowSeconds: number,
): VerifyResult {
  const h = headerSchema.safeParse(header);
  // Pin EdDSA to stop algorithm-confusion / "alg: none" downgrades.
  if (!h.success || h.data.alg !== "EdDSA") {
    return { ok: false, reason: "bad_alg" };
  }

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "bad_claims" };
  const claims = parsed.data;

  if (claims.iss !== SSO_ISSUER) return { ok: false, reason: "bad_iss" };
  if (claims.aud !== SSO_AUDIENCE) return { ok: false, reason: "bad_aud" };

  // Expired (allow a small skew so a marginally-fast issuer clock is tolerated).
  if (claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  // Issued in the future beyond the skew allowance.
  if (claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    return { ok: false, reason: "iat_future" };
  }
  // Reject a token minted with an over-long lifetime (defends the ≤60s TTL even
  // if the issuer sets a distant `exp`). Both times share the issuer's clock,
  // so no skew tolerance is needed here.
  if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) {
    return { ok: false, reason: "lifetime" };
  }

  return { ok: true, claims };
}

/**
 * Verify a token's Ed25519 signature against an explicit public key, then its
 * claims. Exported for tests that mint tokens with a throwaway keypair; the
 * route uses `verifyRosterHandoffToken`, which supplies the pinned key.
 */
export function verifyHandoffTokenWithKey(
  token: string,
  publicKey: KeyObject,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  // Verify the signature BEFORE trusting any decoded field.
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      null,
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      Buffer.from(signatureB64, "base64url"),
    );
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!signatureValid) return { ok: false, reason: "bad_signature" };

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeSegment(headerB64);
    payload = decodeSegment(payloadB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  return validateHandoffClaims(header, payload, nowSeconds);
}

/** Lazily loaded, cached public key (parse once, reuse across requests). */
let cachedKey: KeyObject | null | undefined;

function loadPublicKey(): KeyObject | null {
  const raw = env.PROMPT2EAT_SSO_PUBLIC_KEY?.trim();
  if (!raw) return null;
  // Accept a raw PEM or its base64 (the contract lets the operator pick one).
  const pem = raw.includes("-----BEGIN")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  return createPublicKey(pem);
}

function publicKey(): KeyObject | null {
  if (cachedKey === undefined) {
    try {
      cachedKey = loadPublicKey();
      if (!cachedKey) {
        logger.warn(
          "PROMPT2EAT_SSO_PUBLIC_KEY is not set — inbound SSO fails closed",
        );
      }
    } catch (err) {
      logger.error({ err }, "failed to parse PROMPT2EAT_SSO_PUBLIC_KEY");
      cachedKey = null;
    }
  }
  return cachedKey;
}

/**
 * Verify an inbound prompt2eat handoff token against the env-pinned public key.
 * Fails CLOSED (`reason: "no_key"`) when the key is unset or unparseable, so a
 * misconfigured deployment rejects every handoff rather than trusting one.
 */
export function verifyRosterHandoffToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  const key = publicKey();
  if (!key) return { ok: false, reason: "no_key" };
  return verifyHandoffTokenWithKey(token, key, nowSeconds);
}
