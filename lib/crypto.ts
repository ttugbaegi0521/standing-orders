// AES-256-GCM for the PayPal vault token at rest (users.paypal_vault_token_enc).
// Plaintext must never be logged and never reach LLM context: only lib/paypal.ts decrypts.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

function loadKey(): Buffer {
  const raw = process.env.VAULT_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not set");
  // 64 hex chars or base64 of 32 bytes (e.g. `openssl rand -base64 32`).
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

/** Returns `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64url"));
  return [VERSION, ...parts].join(".");
}

/** Throws on a wrong key, tampering, or a malformed blob. The error never includes the input. */
export function decryptSecret(blob: string): string {
  const [version, iv, tag, ciphertext] = blob.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("malformed encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
