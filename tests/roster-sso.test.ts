import { describe, it, expect } from "vitest";
import {
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import {
  validateHandoffClaims,
  verifyHandoffTokenWithKey,
  SSO_ISSUER,
  SSO_AUDIENCE,
  CLOCK_SKEW_SECONDS,
  MAX_TOKEN_LIFETIME_SECONDS,
  type RosterHandoffClaims,
} from "@/lib/sso/roster-sso";

/**
 * Verification of inbound prompt2eat handoff tokens. We mint tokens here with a
 * throwaway Ed25519 keypair (mirroring how prompt2eat signs, `crypto.sign(null,
 * ...)`), then assert the happy path plus every rejection the contract requires:
 * forged signature, tampered payload, wrong issuer/audience, wrong algorithm,
 * expiry (with skew), future `iat`, and over-long lifetime.
 */

const NOW = 1_800_000_000; // fixed reference time (unix seconds)

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function baseClaims(overrides: Partial<RosterHandoffClaims> = {}) {
  return {
    iss: SSO_ISSUER,
    aud: SSO_AUDIENCE,
    iat: NOW,
    exp: NOW + 60,
    jti: crypto.randomUUID(),
    email: "owner@example.com",
    name: "Ada Owner",
    venue: { id: "v1", slug: "cafe-ada", name: "Cafe Ada" },
    entitlements: { roster: true },
    ...overrides,
  };
}

function mint(
  privateKey: KeyObject,
  claims: object,
  header: object = { alg: "EdDSA", typ: "JWT" },
): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  const signature = cryptoSign(null, Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${b64url(signature)}`;
}

function freshKeys() {
  return generateKeyPairSync("ed25519");
}

describe("verifyHandoffTokenWithKey", () => {
  it("accepts a valid, correctly-signed token and returns the claims", () => {
    const { privateKey, publicKey } = freshKeys();
    const claims = baseClaims();
    const token = mint(privateKey, claims);

    const result = verifyHandoffTokenWithKey(token, publicKey, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.email).toBe("owner@example.com");
      expect(result.claims.venue?.slug).toBe("cafe-ada");
      expect(result.claims.entitlements?.roster).toBe(true);
    }
  });

  it("rejects a token signed by a different key (forgery)", () => {
    const { privateKey } = freshKeys();
    const { publicKey: otherPublic } = freshKeys();
    const token = mint(privateKey, baseClaims());

    const result = verifyHandoffTokenWithKey(token, otherPublic, NOW);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a token whose payload was tampered after signing", () => {
    const { privateKey, publicKey } = freshKeys();
    const token = mint(privateKey, baseClaims());
    const [h, , s] = token.split(".");
    const forgedPayload = b64url(
      JSON.stringify(baseClaims({ email: "attacker@evil.example" })),
    );
    const tampered = `${h}.${forgedPayload}.${s}`;

    const result = verifyHandoffTokenWithKey(tampered, publicKey, NOW);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a malformed token", () => {
    const { publicKey } = freshKeys();
    expect(verifyHandoffTokenWithKey("not-a-jwt", publicKey, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a non-EdDSA algorithm (alg confusion / none)", () => {
    const { privateKey, publicKey } = freshKeys();
    // Sign the real bytes but advertise a different alg in the header.
    const token = mint(privateKey, baseClaims(), { alg: "none", typ: "JWT" });
    const result = verifyHandoffTokenWithKey(token, publicKey, NOW);
    expect(result).toEqual({ ok: false, reason: "bad_alg" });
  });

  it("rejects the wrong issuer and audience", () => {
    const { privateKey, publicKey } = freshKeys();
    const badIss = mint(privateKey, baseClaims({ iss: "someone-else" }));
    expect(verifyHandoffTokenWithKey(badIss, publicKey, NOW)).toEqual({
      ok: false,
      reason: "bad_iss",
    });
    const badAud = mint(privateKey, baseClaims({ aud: "other-app" }));
    expect(verifyHandoffTokenWithKey(badAud, publicKey, NOW)).toEqual({
      ok: false,
      reason: "bad_aud",
    });
  });

  it("rejects an expired token but tolerates skew", () => {
    const { privateKey, publicKey } = freshKeys();
    const claims = baseClaims({ iat: NOW - 60, exp: NOW - 5 });
    const token = mint(privateKey, claims);

    // 5s past exp — within the 30s skew allowance, still accepted.
    expect(verifyHandoffTokenWithKey(token, publicKey, NOW).ok).toBe(true);
    // Well past exp + skew — rejected.
    const later = NOW + CLOCK_SKEW_SECONDS + 1;
    expect(verifyHandoffTokenWithKey(token, publicKey, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a token issued in the future beyond the skew", () => {
    const { privateKey, publicKey } = freshKeys();
    const claims = baseClaims({
      iat: NOW + CLOCK_SKEW_SECONDS + 5,
      exp: NOW + CLOCK_SKEW_SECONDS + 65,
    });
    const token = mint(privateKey, claims);
    expect(verifyHandoffTokenWithKey(token, publicKey, NOW)).toEqual({
      ok: false,
      reason: "iat_future",
    });
  });

  it("rejects a token minted with an over-long lifetime", () => {
    const { privateKey, publicKey } = freshKeys();
    const claims = baseClaims({
      iat: NOW,
      exp: NOW + MAX_TOKEN_LIFETIME_SECONDS + 1,
    });
    const token = mint(privateKey, claims);
    expect(verifyHandoffTokenWithKey(token, publicKey, NOW)).toEqual({
      ok: false,
      reason: "lifetime",
    });
  });

  it("rejects a token missing required claims", () => {
    const { privateKey, publicKey } = freshKeys();
    const { email: _omit, ...noEmail } = baseClaims();
    void _omit;
    const token = mint(privateKey, noEmail);
    expect(verifyHandoffTokenWithKey(token, publicKey, NOW)).toEqual({
      ok: false,
      reason: "bad_claims",
    });
  });
});

describe("validateHandoffClaims (pure)", () => {
  const header = { alg: "EdDSA", typ: "JWT" };

  it("accepts well-formed claims", () => {
    expect(validateHandoffClaims(header, baseClaims(), NOW).ok).toBe(true);
  });

  it("does not require venue or entitlements (best-effort context)", () => {
    const { venue: _v, entitlements: _e, ...lean } = baseClaims();
    void _v;
    void _e;
    expect(validateHandoffClaims(header, lean, NOW).ok).toBe(true);
  });

  it("rejects a non-email email claim", () => {
    const result = validateHandoffClaims(
      header,
      baseClaims({ email: "not-an-email" }),
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "bad_claims" });
  });
});
