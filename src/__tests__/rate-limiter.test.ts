/**
 * Token-Bucket Rate Limiter Tests
 *
 * Verifies rate limiting at 2 req/sec prevents 429 errors.
 */

import {
  TokenBucketRateLimiter,
  FULFILLMENT_RATE_LIMIT,
  INVENTORY_RATE_LIMIT,
} from "@/lib/api/rate-limiter/token-bucket";

describe("Token-Bucket Rate Limiter", () => {
  it("should allow burst up to max tokens", () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 5,
      refillRate: 2,
      refillIntervalMs: 1000,
    });

    // Should allow 5 immediate requests (burst)
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }

    // 6th should be rate limited
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("should refill tokens over time", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 2,
      refillRate: 10,
      refillIntervalMs: 1000,
    });

    // Consume all tokens
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);

    // Wait 250ms — should refill ~2.5 tokens at 10/sec (capped at 2)
    await new Promise((r) => setTimeout(r, 250));
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("should not exceed max tokens during refill", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 3,
      refillRate: 100,
      refillIntervalMs: 1000,
    });

    // Wait long enough for many tokens to accumulate
    await new Promise((r) => setTimeout(r, 200));

    // Should only get 3 (max), not 20+
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("should wait for token availability with acquire()", async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 1,
      refillRate: 10,
      refillIntervalMs: 1000,
    });

    // Consume the only token
    limiter.tryAcquire();

    const start = Date.now();
    await limiter.acquire(); // Should wait ~100ms for a refill
    const elapsed = Date.now() - start;

    // Should have waited at least ~50ms (with timing tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(500);
  });

  it("should report state correctly", () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 30,
      refillRate: 2,
      refillIntervalMs: 1000,
    });

    const available = limiter.getAvailableTokens();
    expect(available).toBeLessThanOrEqual(30);
    expect(available).toBeGreaterThanOrEqual(0);
  });

  it("should handle Fulfillment Outbound config (2 req/sec, burst 30)", () => {
    const limiter = new TokenBucketRateLimiter(FULFILLMENT_RATE_LIMIT);

    // Should allow 30 burst requests
    let consumed = 0;
    while (limiter.tryAcquire()) {
      consumed++;
    }
    expect(consumed).toBe(30);
  });

  it("should handle FBA Inventory config (2 req/sec, burst 2)", () => {
    const limiter = new TokenBucketRateLimiter(INVENTORY_RATE_LIMIT);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });
});
