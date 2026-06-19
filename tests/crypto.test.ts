import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeEncryptionKey,
  decryptWithKey,
  encryptWithKey,
} from "@/lib/crypto";

const key = randomBytes(32);

describe("crypto (AES-256-GCM secret encryption)", () => {
  it("round-trips a secret", () => {
    const plaintext = "ya29.a0AfH6SMexample-refresh-token";
    const ciphertext = encryptWithKey(plaintext, key);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptWithKey(ciphertext, key)).toBe(plaintext);
  });

  it("produces a versioned 4-part payload", () => {
    const parts = encryptWithKey("hello", key).split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("uses a fresh IV each time (ciphertext differs for same input)", () => {
    const a = encryptWithKey("same", key);
    const b = encryptWithKey("same", key);
    expect(a).not.toBe(b);
    expect(decryptWithKey(a, key)).toBe("same");
    expect(decryptWithKey(b, key)).toBe("same");
  });

  it("rejects a tampered ciphertext (auth tag mismatch)", () => {
    const ciphertext = encryptWithKey("secret", key);
    const parts = ciphertext.split(".");
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3]!, "base64url");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64url");
    expect(() => decryptWithKey(parts.join("."), key)).toThrow();
  });

  it("rejects decryption with the wrong key", () => {
    const ciphertext = encryptWithKey("secret", key);
    expect(() => decryptWithKey(ciphertext, randomBytes(32))).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptWithKey("not-valid", key)).toThrow("Malformed");
    expect(() => decryptWithKey("v2.a.b.c", key)).toThrow("Malformed");
  });

  it("validates key length", () => {
    expect(() =>
      decodeEncryptionKey(randomBytes(16).toString("base64")),
    ).toThrow();
    expect(
      decodeEncryptionKey(randomBytes(32).toString("base64")),
    ).toHaveLength(32);
  });
});
