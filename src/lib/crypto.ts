import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "@/lib/env";

/**
 * Reversible secret encryption (AES-256-GCM) for data we must be able to read
 * back — specifically the Google Drive OAuth access/refresh tokens stored at
 * rest. The rest of the app only ever HASHES secrets (PINs, capability tokens),
 * which is one-way and so unsuitable here.
 *
 * Stored format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. Every
 * encryption uses a fresh random 96-bit IV; the GCM auth tag is verified on
 * decrypt so tampered ciphertext is rejected (throws) rather than returning
 * garbage. The key is 32 random bytes provided base64 in TOKEN_ENCRYPTION_KEY.
 *
 * FAIL CLOSED: callers (the Drive connect flow) check `isEncryptionConfigured()`
 * first and refuse to store a token when the key is absent/invalid, so a token
 * is never written in plaintext.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the standard for GCM
const KEY_BYTES = 32; // AES-256

/** Decode + validate the base64 key. Throws if it isn't exactly 32 bytes. */
export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/** The configured key, or null when unset/invalid (never throws). */
export function getEncryptionKey(): Buffer | null {
  const raw = env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    return decodeEncryptionKey(raw);
  } catch {
    return null;
  }
}

/** Whether reversible token encryption is available (key present + valid). */
export function isEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}

/** Encrypt with an explicit key (pure; used directly in tests). */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Decrypt with an explicit key (pure; used directly in tests). */
export function decryptWithKey(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed ciphertext");
  }
  const iv = Buffer.from(parts[1]!, "base64url");
  const authTag = Buffer.from(parts[2]!, "base64url");
  const data = Buffer.from(parts[3]!, "base64url");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Encrypt using the env-configured key. Throws if the key is unset/invalid —
 * callers must gate on `isEncryptionConfigured()` so this never surprises them.
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return encryptWithKey(plaintext, key);
}

/** Decrypt using the env-configured key. Throws if the key is unset/invalid. */
export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return decryptWithKey(payload, key);
}
