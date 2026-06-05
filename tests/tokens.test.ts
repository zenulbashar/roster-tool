import { describe, it, expect } from "vitest";
import { generateToken, hashToken, safeHashEqual } from "@/lib/tokens";

describe("tokens", () => {
  it("generates a high-entropy token and a matching hash", () => {
    const { token, tokenHash } = generateToken();
    expect(token.length).toBeGreaterThan(20);
    expect(tokenHash).toBe(hashToken(token));
    // The hash must not be the raw token.
    expect(tokenHash).not.toBe(token);
  });

  it("produces unique tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hashes deterministically", () => {
    expect(hashToken("hello")).toBe(hashToken("hello"));
    expect(hashToken("hello")).not.toBe(hashToken("world"));
  });

  it("compares hashes in constant time", () => {
    const h = hashToken("secret");
    expect(safeHashEqual(h, h)).toBe(true);
    expect(safeHashEqual(h, hashToken("other"))).toBe(false);
    expect(safeHashEqual(h, "")).toBe(false);
  });
});
