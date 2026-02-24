/**
 * Non-Negotiable Rule #2 — Randomized Delay Layer
 *
 * ALL influencer-facing messages must pass through this layer.
 * It applies a subtle, randomized delay so creators never suspect
 * they are talking to an AI.
 *
 * Implemented at the message-sending layer so no calling code can
 * bypass or skip the delay.
 */

export interface DelayConfig {
  /** Minimum delay in milliseconds (default: 30000 = 30s) */
  minDelayMs: number;
  /** Maximum delay in milliseconds (default: 300000 = 5min) */
  maxDelayMs: number;
}

export type MessageType =
  | "im"
  | "invitation"
  | "approval"
  | "rejection"
  | "brief_delivery"
  | "tracking_update";

export interface DelayedMessage {
  messageId: string;
  type: MessageType;
  recipientId: string;
  content: string;
  actualDelayMs: number;
  scheduledAt: Date;
  deliverAt: Date;
}

export class InfluencerDelayLayer {
  private config: DelayConfig;

  constructor(config?: Partial<DelayConfig>) {
    this.config = {
      minDelayMs: config?.minDelayMs ?? 30000,
      maxDelayMs: config?.maxDelayMs ?? 300000,
    };
  }

  /**
   * Schedule a message with a randomized delay.
   * This is the ONLY entry point for sending influencer-facing messages.
   * The delay is non-bypassable by design.
   */
  async scheduleMessage(
    type: MessageType,
    recipientId: string,
    content: string
  ): Promise<DelayedMessage> {
    const delay = this.calculateDelay();
    const now = new Date();

    const message: DelayedMessage = {
      messageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      recipientId,
      content,
      actualDelayMs: delay,
      scheduledAt: now,
      deliverAt: new Date(now.getTime() + delay),
    };

    // Actually wait the delay — this is what makes it non-bypassable
    await this.wait(delay);

    return message;
  }

  /**
   * Calculate a random delay between minDelayMs and maxDelayMs.
   * Uses uniform distribution across the configured range.
   */
  calculateDelay(): number {
    const { minDelayMs, maxDelayMs } = this.config;
    return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Return a copy of the current configuration */
  getConfig(): DelayConfig {
    return { ...this.config };
  }
}
