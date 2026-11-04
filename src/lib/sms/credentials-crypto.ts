// Server-only. AES-256-GCM for per-school Twilio auth tokens (spec §7.3).
// Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("SMS_CREDENTIALS_KEY must be 32 bytes (base64).");
  return key;
}

/** The key from env; throws a clear error if it's missing. */
export function credentialsKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.SMS_CREDENTIALS_KEY?.trim();
  if (!key) throw new Error("SMS_CREDENTIALS_KEY is not set.");
  return key;
}

export function encryptSecret(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(sealed: string, keyBase64: string): string {
  if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format.");
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(keyBase64), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
