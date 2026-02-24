/**
 * SQS Message Processor for Fulfillment
 *
 * Enhances the base SQS consumer (Section 2.5) to:
 * - Parse fulfillment status updates from SQS
 * - Update the orders table with status + tracking info
 * - Call getFulfillmentOrder to retrieve packageNumber(s)
 * - Call getPackageTrackingDetails for tracking info
 * - Notify the creator through the delay layer
 *
 * This bridges the SQS consumer with the fulfillment orchestrator.
 */

import { Pool } from "pg";
import { FulfillmentOutboundClient } from "@/lib/api/amazon/fulfillment-outbound";
import { FulfillmentOrderStatusNotification, FulfillmentOrderStatus, GetFulfillmentOrderResponse } from "@/lib/api/amazon/types";
import { InfluencerMessageSender } from "@/lib/messaging/sender";
import { traced } from "@/lib/llm/langsmith";
import { setAdminAlert, AdminAlertFn } from "./orchestrator";

/** Statuses that indicate shipment has occurred */
const SHIPPED_STATUSES: FulfillmentOrderStatus[] = [
  "Complete",
  "CompletePartialled",
  "Processing",
];

export class FulfillmentSqsProcessor {
  private fulfillmentClient: FulfillmentOutboundClient;
  private messageSender: InfluencerMessageSender;
  private db: Pool;

  constructor(
    fulfillmentClient: FulfillmentOutboundClient,
    messageSender: InfluencerMessageSender,
    db: Pool
  ) {
    this.fulfillmentClient = fulfillmentClient;
    this.messageSender = messageSender;
    this.db = db;
  }

  /**
   * Process a FULFILLMENT_ORDER_STATUS notification.
   * Called by the SQS consumer after parsing the message.
   */
  async processStatusUpdate(
    notification: FulfillmentOrderStatusNotification
  ): Promise<void> {
    const processTracked = traced(
      async (notif: FulfillmentOrderStatusNotification) => {
        const { sellerFulfillmentOrderId, fulfillmentOrderStatus } = notif.payload;

        // Update orders table
        const statusEntry = {
          status: fulfillmentOrderStatus,
          updatedAt: notif.payload.statusUpdatedDate,
          processedAt: new Date().toISOString(),
          shipment: notif.payload.fulfillmentShipment ?? null,
        };

        await this.db.query(
          `UPDATE orders
           SET status = $1,
               status_webhook_log = status_webhook_log || $2::jsonb,
               updated_at = NOW()
           WHERE fulfillment_id = $3`,
          [fulfillmentOrderStatus, JSON.stringify(statusEntry), sellerFulfillmentOrderId]
        );

        // If the order has shipped, retrieve tracking and notify creator
        if (SHIPPED_STATUSES.includes(fulfillmentOrderStatus)) {
          await this.retrieveAndNotifyTracking(sellerFulfillmentOrderId);
        }
      },
      {
        name: "sqs-processor-status-update",
        runType: "chain",
        metadata: {
          orderId: notification.payload.sellerFulfillmentOrderId,
          status: notification.payload.fulfillmentOrderStatus,
        },
      }
    );

    await processTracked(notification);
  }

  /**
   * Step 7 + 8: Retrieve packageNumbers → get tracking → notify creator.
   */
  private async retrieveAndNotifyTracking(
    sellerFulfillmentOrderId: string
  ): Promise<void> {
    const doRetrieve = traced(
      async () => {
        // Look up the creator ID for this order
        const orderRow = await this.db.query(
          `SELECT pii_data, status_webhook_log FROM orders WHERE fulfillment_id = $1`,
          [sellerFulfillmentOrderId]
        );

        if (orderRow.rows.length === 0) {
          console.warn(
            `[SqsProcessor] No order found for fulfillment_id: ${sellerFulfillmentOrderId}`
          );
          return;
        }

        // Extract creator_id from the status_webhook_log (set during creation)
        const webhookLog = orderRow.rows[0].status_webhook_log;
        const creatorId = this.extractCreatorId(webhookLog);
        if (!creatorId) {
          console.warn(
            `[SqsProcessor] No creator_id found in webhook log for: ${sellerFulfillmentOrderId}`
          );
          return;
        }

        // Step 7: Get fulfillment order to retrieve packageNumber(s)
        const orderResponse = await this.fulfillmentClient.getFulfillmentOrder(
          sellerFulfillmentOrderId
        );

        const packageNumbers: number[] = [];
        for (const shipment of orderResponse.payload.fulfillmentShipments) {
          if (shipment.fulfillmentShipmentPackage) {
            for (const pkg of shipment.fulfillmentShipmentPackage) {
              if (pkg.packageNumber && !packageNumbers.includes(pkg.packageNumber)) {
                packageNumbers.push(pkg.packageNumber);
              }
            }
          }
        }

        if (packageNumbers.length === 0) {
          console.warn(
            `[SqsProcessor] No packageNumbers found for: ${sellerFulfillmentOrderId}`
          );
          return;
        }

        // Step 8: Get tracking details for first package
        const tracking = await this.fulfillmentClient.getPackageTrackingDetails(
          packageNumbers[0]
        );

        if (tracking.trackingNumber) {
          // Update orders table with tracking
          await this.db.query(
            `UPDATE orders
             SET tracking_num = $1, updated_at = NOW()
             WHERE fulfillment_id = $2`,
            [tracking.trackingNumber, sellerFulfillmentOrderId]
          );

          // Notify creator through delay layer
          const estimatedDelivery = tracking.estimatedArrival
            ? tracking.estimatedArrival.latestArrivalDate
            : undefined;
          const trackingMessage = [
            `Your order has shipped! Tracking: ${tracking.trackingNumber}`,
            `Carrier: ${tracking.carrierCode}`,
            estimatedDelivery ? `Estimated delivery: ${estimatedDelivery}` : "",
          ].filter(Boolean).join("\n");

          await this.messageSender.send(
            "tracking_update",
            creatorId,
            trackingMessage,
          );
        }
      },
      {
        name: "sqs-processor-retrieve-tracking",
        runType: "tool",
        metadata: { orderId: sellerFulfillmentOrderId },
      }
    );

    try {
      await doRetrieve();
    } catch (err) {
      console.error(
        `[SqsProcessor] Failed to retrieve tracking for ${sellerFulfillmentOrderId}:`,
        err
      );
      // Don't throw — status update was already saved, tracking can be retried
    }
  }

  /**
   * Extract creator_id from the order's status_webhook_log.
   * The creator_id is stored when the order is first created by the sample handler.
   */
  private extractCreatorId(
    webhookLog: unknown
  ): string | null {
    if (!Array.isArray(webhookLog) && typeof webhookLog !== "object") {
      return null;
    }

    // webhookLog can be either a JSONB array or object
    const entries = Array.isArray(webhookLog) ? webhookLog : [webhookLog];

    for (const entry of entries) {
      if (entry && typeof entry === "object" && "creator_id" in entry) {
        return (entry as { creator_id: string }).creator_id;
      }
    }

    return null;
  }
}

export { setAdminAlert };
export type { AdminAlertFn };
