/**
 * TikTok Webhook Handler Tests
 *
 * Tests shared secret validation — valid payloads accepted,
 * invalid/unsigned payloads rejected.
 */

import * as crypto from "crypto";

// We test the verification logic directly since Next.js route handlers
// are hard to test in isolation without the full Next.js runtime.

const WEBHOOK_SECRET = "test-webhook-secret-12345";

function createSignature(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function verifySignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

describe("TikTok Webhook Signature Verification", () => {
  it("should accept a correctly signed payload", () => {
    const body = JSON.stringify({ event: "sample_request", data: { id: "1" } });
    const signature = createSignature(body, WEBHOOK_SECRET);

    expect(verifySignature(body, signature, WEBHOOK_SECRET)).toBe(true);
  });

  it("should reject a payload with wrong signature", () => {
    const body = JSON.stringify({ event: "sample_request" });
    const wrongSignature = createSignature(body, "wrong-secret");

    expect(verifySignature(body, wrongSignature, WEBHOOK_SECRET)).toBe(false);
  });

  it("should reject a payload with no signature", () => {
    const body = JSON.stringify({ event: "sample_request" });

    expect(verifySignature(body, null, WEBHOOK_SECRET)).toBe(false);
  });

  it("should reject a payload with empty signature", () => {
    const body = JSON.stringify({ event: "sample_request" });

    expect(verifySignature(body, "", WEBHOOK_SECRET)).toBe(false);
  });

  it("should reject a tampered payload", () => {
    const originalBody = JSON.stringify({ event: "sample_request", amount: 100 });
    const signature = createSignature(originalBody, WEBHOOK_SECRET);

    // Tamper with the body
    const tamperedBody = JSON.stringify({ event: "sample_request", amount: 999 });

    expect(verifySignature(tamperedBody, signature, WEBHOOK_SECRET)).toBe(false);
  });

  it("should reject when secret is empty", () => {
    const body = JSON.stringify({ event: "test" });
    const signature = createSignature(body, WEBHOOK_SECRET);

    expect(verifySignature(body, signature, "")).toBe(false);
  });

  it("should reject malformed hex signature", () => {
    const body = JSON.stringify({ event: "test" });

    expect(verifySignature(body, "not-valid-hex-!@#$", WEBHOOK_SECRET)).toBe(false);
  });
});
