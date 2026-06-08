import { describe, it, expect } from "vitest";
import { signInErrorMessage } from "@/lib/auth/sign-in-error";

describe("signInErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(signInErrorMessage(undefined)).toBeNull();
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage("")).toBeNull();
  });

  it("explains an expired/used magic link (Verification)", () => {
    const msg = signInErrorMessage("Verification");
    expect(msg).toMatch(/expired or was already used/i);
    expect(msg).toMatch(/email/i);
  });

  it("handles access denied", () => {
    expect(signInErrorMessage("AccessDenied")).toMatch(/access/i);
  });

  it("falls back to a generic message for unknown/Configuration codes", () => {
    expect(signInErrorMessage("Configuration")).toMatch(/went wrong/i);
    expect(signInErrorMessage("Default")).toMatch(/went wrong/i);
    expect(signInErrorMessage("SomethingNew")).toMatch(/went wrong/i);
  });
});
