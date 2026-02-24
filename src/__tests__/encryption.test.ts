/**
 * Encryption Tests
 *
 * Verifies AES-256-GCM encryption/decryption for token storage.
 */

import { encrypt, decrypt, getEncryptionKey } from "@/lib/crypto/encryption";

// Set a test encryption key (32 bytes = 64 hex chars)
const TEST_KEY_HEX = "a".repeat(64);

describe("AES-256-GCM Encryption", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterAll(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("should encrypt and decrypt a string", () => {
    const plaintext = "my-secret-access-token-12345";
    const { encrypted, iv } = encrypt(plaintext);

    expect(encrypted).toBeDefined();
    expect(iv).toBeDefined();
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, iv);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertexts for the same plaintext (random IV)", () => {
    const plaintext = "same-token";
    const result1 = encrypt(plaintext);
    const result2 = encrypt(plaintext);

    expect(result1.encrypted).not.toBe(result2.encrypted);
    expect(result1.iv).not.toBe(result2.iv);

    expect(decrypt(result1.encrypted, result1.iv)).toBe(plaintext);
    expect(decrypt(result2.encrypted, result2.iv)).toBe(plaintext);
  });

  it("should encrypt/decrypt via string serialization", () => {
    const plaintext = '{"access_token": "abc123", "refresh_token": "def456"}';
    const { encrypted, iv } = encrypt(plaintext);

    const serialized = JSON.stringify({ encrypted, iv });
    expect(serialized).not.toContain("abc123");

    const parsed = JSON.parse(serialized);
    const deserialized = decrypt(parsed.encrypted, parsed.iv);
    expect(deserialized).toBe(plaintext);
  });

  it("should reject tampered ciphertext", () => {
    const plaintext = "sensitive-data";
    const { encrypted, iv } = encrypt(plaintext);

    // Tamper with ciphertext
    const tampered = "AAAA" + encrypted.slice(4);

    expect(() => decrypt(tampered, iv)).toThrow();
  });

  it("should throw if TOKEN_ENCRYPTION_KEY is not set", () => {
    const savedKey = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    expect(() => getEncryptionKey()).toThrow("TOKEN_ENCRYPTION_KEY");

    process.env.TOKEN_ENCRYPTION_KEY = savedKey;
  });
});
