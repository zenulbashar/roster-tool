import { describe, expect, it } from "vitest";
import {
  buildGoogleAuthUrl,
  DRIVE_SCOPE,
  isTokenExpired,
} from "@/lib/google-drive/tokens";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  validateUpload,
} from "@/lib/google-drive/validation";

describe("isTokenExpired", () => {
  const expiry = new Date("2026-01-01T12:00:00Z");

  it("is false well before expiry", () => {
    expect(isTokenExpired(expiry, new Date("2026-01-01T11:00:00Z"))).toBe(false);
  });

  it("is true after expiry", () => {
    expect(isTokenExpired(expiry, new Date("2026-01-01T12:30:00Z"))).toBe(true);
  });

  it("treats the token as expired inside the skew window", () => {
    // 30s before expiry, default 60s skew → already considered expired.
    expect(isTokenExpired(expiry, new Date("2026-01-01T11:59:30Z"))).toBe(true);
  });

  it("respects a custom skew of 0", () => {
    expect(
      isTokenExpired(expiry, new Date("2026-01-01T11:59:30Z"), 0),
    ).toBe(false);
  });
});

describe("buildGoogleAuthUrl", () => {
  const url = new URL(
    buildGoogleAuthUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "https://roster.example/api/integrations/google/callback",
      state: "nonce123",
    }),
  );

  it("targets Google's consent endpoint", () => {
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("requests ONLY the drive.file scope", () => {
    expect(url.searchParams.get("scope")).toBe(DRIVE_SCOPE);
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("asks for offline access + consent (so a refresh token is issued)", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("carries the CSRF state and client/redirect", () => {
    expect(url.searchParams.get("state")).toBe("nonce123");
    expect(url.searchParams.get("client_id")).toBe(
      "cid.apps.googleusercontent.com",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("validateUpload", () => {
  it("accepts an allowed type within the size limit", () => {
    expect(
      validateUpload({ size: 1024, mimeType: "application/pdf" }),
    ).toEqual({ ok: true });
    for (const mimeType of ALLOWED_MIME_TYPES) {
      expect(validateUpload({ size: 1, mimeType }).ok).toBe(true);
    }
  });

  it("rejects an empty file", () => {
    const r = validateUpload({ size: 0, mimeType: "application/pdf" });
    expect(r).toMatchObject({ ok: false, reason: "empty" });
  });

  it("rejects a file over 10 MB", () => {
    const r = validateUpload({
      size: MAX_UPLOAD_BYTES + 1,
      mimeType: "application/pdf",
    });
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("rejects a disallowed type (e.g. an executable)", () => {
    const r = validateUpload({
      size: 100,
      mimeType: "application/x-msdownload",
    });
    expect(r).toMatchObject({ ok: false, reason: "bad_type" });
  });
});
