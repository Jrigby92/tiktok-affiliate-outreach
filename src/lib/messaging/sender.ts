/**
 * InfluencerMessageSender
 *
 * ALL influencer-facing messages go through this sender, which
 * forces every message through the InfluencerDelayLayer.
 *
 * There is no "fast path" or direct-send option. The delay layer
 * is architecturally non-bypassable because this sender is the
 * only export for sending influencer messages.
 */

import {
  InfluencerDelayLayer,
  MessageType,
  DelayedMessage,
} from "./delay-layer";

export class InfluencerMessageSender {
  private delayLayer: InfluencerDelayLayer;
  private sendFn: (
    recipientId: string,
    content: string,
    type: MessageType
  ) => Promise<void>;

  constructor(
    delayLayer: InfluencerDelayLayer,
    sendFn: (
      recipientId: string,
      content: string,
      type: MessageType
    ) => Promise<void>
  ) {
    this.delayLayer = delayLayer;
    this.sendFn = sendFn;
  }

  /**
   * Send a message to an influencer. The delay layer runs FIRST;
   * the actual send function only fires after the randomized wait.
   */
  async send(
    type: MessageType,
    recipientId: string,
    content: string
  ): Promise<DelayedMessage> {
    // Delay is applied before the actual send — non-bypassable
    const delayed = await this.delayLayer.scheduleMessage(
      type,
      recipientId,
      content
    );
    await this.sendFn(recipientId, content, type);
    return delayed;
  }

  /**
   * Send a tracking notification to a creator.
   * Delegates to send() with type "tracking_update".
   */
  async sendTrackingNotification(params: {
    creatorId: string;
    trackingNumber: string;
    carrier?: string;
    estimatedDelivery?: string;
  }): Promise<DelayedMessage> {
    const content = [
      `Your sample is on its way! Tracking: ${params.trackingNumber}`,
      params.carrier ? `Carrier: ${params.carrier}` : "",
      params.estimatedDelivery
        ? `Estimated delivery: ${params.estimatedDelivery}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return this.send("tracking_update", params.creatorId, content);
  }

  /**
   * Send a sample decision notification to a creator.
   * Delegates to send() with type "approval" or "rejection".
   */
  async sendSampleNotification(params: {
    requestId: string;
    creatorId: string;
    decision: "approved" | "rejected";
    reason?: string;
    productId: string;
  }): Promise<DelayedMessage> {
    const type: MessageType =
      params.decision === "approved" ? "approval" : "rejection";

    const content =
      params.decision === "approved"
        ? `Your sample request (${params.requestId}) for product ${params.productId} has been approved! We'll send you tracking details soon.`
        : `Your sample request (${params.requestId}) for product ${params.productId} was not approved.${params.reason ? ` Reason: ${params.reason}` : ""}`;

    return this.send(type, params.creatorId, content);
  }

  /**
   * Send a collaboration invitation to a creator.
   * Delegates to send() with type "invitation".
   */
  async sendCollaborationInvitation(params: {
    creatorId: string;
    productIds: string[];
    commissionRate: number;
    message: string;
  }): Promise<DelayedMessage> {
    return this.send("invitation", params.creatorId, params.message);
  }
}
