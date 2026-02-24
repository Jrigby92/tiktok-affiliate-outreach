import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  return Buffer.from(key, "hex");
}

export function encrypt(
  plaintext: string,
  key?: Buffer
): { encrypted: string; iv: string } {
  const encKey = key || getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encKey, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted + tag.toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decrypt(
  encryptedHex: string,
  ivHex: string,
  key?: Buffer
): string {
  const encKey = key || getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const tagStart = encryptedHex.length - TAG_LENGTH * 2;
  const encrypted = encryptedHex.slice(0, tagStart);
  const tag = Buffer.from(encryptedHex.slice(tagStart), "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, encKey, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
