// ============================================================
// Token Bucket Rate Limiter
// Timestamp-based refill — no timers or intervals.
// ============================================================

export interface TokenBucketConfig {
  /** Maximum tokens the bucket can hold (burst capacity) */
  maxTokens: number;
  /** Number of tokens added per refill interval */
  refillRate: number;
  /** Milliseconds between refills */
  refillIntervalMs: number;
}

/**
 * Preset: Amazon Fulfillment Outbound API
 * 2 req/sec sustained, burst 30
 */
export const FULFILLMENT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 30,
  refillRate: 2,
  refillIntervalMs: 1000,
};

/**
 * Preset: Amazon FBA Inventory API
 * 2 req/sec sustained, burst 2
 */
export const INVENTORY_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 2,
  refillRate: 2,
  refillIntervalMs: 1000,
};

export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly refillIntervalMs: number;
  private lastRefillTimestamp: number;

  constructor(config: TokenBucketConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.refillIntervalMs = config.refillIntervalMs;
    this.tokens = config.maxTokens; // Start full
    this.lastRefillTimestamp = Date.now();
  }

  /**
   * Acquire a token, waiting if none are available.
   * Resolves when a token has been consumed.
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // No tokens available — wait for the next refill
    const waitMs = this.msUntilNextToken();
    await this.sleep(waitMs);

    // Refill and try again (recursive but bounded — at most one retry
    // because we waited long enough for at least one token)
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Safety: should not happen, but avoid infinite recursion
    await this.acquire();
  }

  /**
   * Try to acquire a token without waiting.
   * Returns true if a token was consumed, false if the bucket is empty.
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get the current number of available tokens (after refill).
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  // ----------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------

  /**
   * Refill tokens based on elapsed time since last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTimestamp;

    if (elapsed <= 0) return;

    const intervalsElapsed = elapsed / this.refillIntervalMs;
    const tokensToAdd = intervalsElapsed * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(
        this.maxTokens,
        this.tokens + tokensToAdd
      );
      this.lastRefillTimestamp = now;
    }
  }

  /**
   * Calculate milliseconds until at least one token is available.
   */
  private msUntilNextToken(): number {
    if (this.tokens >= 1) return 0;

    const tokensNeeded = 1 - this.tokens;
    const intervalsNeeded = tokensNeeded / this.refillRate;
    return Math.ceil(intervalsNeeded * this.refillIntervalMs);
  }

  /**
   * Promise-based sleep.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
