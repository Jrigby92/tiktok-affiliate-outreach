/**
 * Amazon MCF Fulfillment Orchestrator
 *
 * Executes the corrected 8-step SP-API sequence:
 *   1. getInventorySummaries       → Verify SKU in stock (FBA Inventory API)
 *   2. getFulfillmentPreview       → Delivery dates, shipping options
 *   3. createFulfillmentOrder      → Place on "Hold" with FillOrKill
 *   4. [Hold window — cancelFulfillmentOrder if cancelled]
 *   5. updateFulfillmentOrder      → Transition "Hold" → "Ship"
 *   6. [SQS: consume FULFILLMENT_ORDER_STATUS notifications]
 *   7. getFulfillmentOrder         → Poll status + retrieve packageNumber(s)
 *   8. getPackageTrackingDetails   → Tracking via packageNumber (int32)
 *      → Notify creator through delay layer
 *
 * Each step verifies success before proceeding. Failure halts the sequence.
 * All calls are LangSmith-traced. Errors alert admin dashboard.
 */

import { Pool } from "pg";
import { Queue } from "bullmq";
import { FbaInventoryClient } from "@/lib/api/amazon/fba-inventory";
import { FulfillmentOutboundClient } from "@/lib/api/amazon/fulfillment-outbound";
import {
  FulfillmentPreview,
  PackageTrackingDetails,
  GetFulfillmentOrderResponse,
  GetFulfillmentPreviewResponse,
  FulfillmentOrderStatus,
  FulfillmentAddress,
  Address,
} from "@/lib/api/amazon/types";
import { InfluencerMessageSender } from "@/lib/messaging/sender";
import { traced } from "@/lib/llm/langsmith";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import {
  FulfillmentJobData,
  HoldToShipJobData,
  FulfillmentResult,
  FulfillmentError,
  FulfillmentErrorCode,
  FulfillmentStep,
  FulfillmentConfig,
  DEFAULT_FULFILLMENT_CONFIG,
  isCancellable,
} from "./types";

// ─── Admin Alert Callback ───

export type AdminAlertFn = (alert: {
  level: "error" | "warning" | "info";
  step: FulfillmentStep;
  orderId: string;
  message: string;
  details?: unknown;
}) => void;

/** Default no-op alert (override via setAdminAlert) */
let adminAlert: AdminAlertFn = (alert) => {
  console.error(`[FulfillmentAlert] [${alert.level}] ${alert.step}: ${alert.message}`);
};

export function setAdminAlert(fn: AdminAlertFn): void {
  adminAlert = fn;
}

// ─── Fulfillment Orchestrator ───

export class FulfillmentOrchestrator {
  private inventoryClient: FbaInventoryClient;
  private fulfillmentClient: FulfillmentOutboundClient;
  private messageSender: InfluencerMessageSender;
  private db: Pool;
  private config: FulfillmentConfig;
  private holdToShipQueue: Queue;

  constructor(
    inventoryClient: FbaInventoryClient,
    fulfillmentClient: FulfillmentOutboundClient,
    messageSender: InfluencerMessageSender,
    db: Pool,
    config?: Partial<FulfillmentConfig>
  ) {
    this.inventoryClient = inventoryClient;
    this.fulfillmentClient = fulfillmentClient;
    this.messageSender = messageSender;
    this.db = db;
    this.config = { ...DEFAULT_FULFILLMENT_CONFIG, ...config };
    this.holdToShipQueue = new Queue(QUEUE_NAMES.FULFILLMENT, {
      connection: redisConnection,
    });
  }

  /**
   * Execute the full 8-step MCF fulfillment sequence.
   * Steps 1–3 execute synchronously. Step 5 is scheduled via BullMQ delayed job.
   * Steps 6–8 happen asynchronously via SQS consumer + tracking processor.
   */
  async executeFulfillment(job: FulfillmentJobData): Promise<FulfillmentResult> {
    const tracedExecute = traced(
      async (jobData: FulfillmentJobData): Promise<FulfillmentResult> => {
        return this._executeFulfillmentInternal(jobData);
      },
      {
        name: "fulfillment-orchestrator",
        runType: "chain",
        metadata: {
          orderId: job.sellerFulfillmentOrderId,
          creatorId: job.creatorId,
          sku: job.sellerSku,
          sampleRequestId: job.sampleRequestId,
        },
      }
    );

    return tracedExecute(job);
  }

  private async _executeFulfillmentInternal(
    job: FulfillmentJobData
  ): Promise<FulfillmentResult> {
    const { sellerFulfillmentOrderId, creatorId, sellerSku, sampleRequestId } = job;

    // ─── Step 1: Check Inventory ───
    const inventoryCheck = traced(
      async (sku: string) => {
        return this.inventoryClient.checkSkuAvailability(sku);
      },
      { name: "mcf-step-1-inventory-check", runType: "tool", metadata: { sku: sellerSku } }
    );

    const inventory = await inventoryCheck(sellerSku).catch((err) => {
      const error = this.buildError("inventory_check", "API_ERROR", err.message, true);
      this.alertAdmin("error", "inventory_check", sellerFulfillmentOrderId, error);
      throw error;
    });

    if (!inventory) {
      const error = this.buildError(
        "inventory_check",
        "INVENTORY_UNAVAILABLE",
        `SKU ${sellerSku} is out of stock or unavailable`,
        false
      );
      this.alertAdmin("error", "inventory_check", sellerFulfillmentOrderId, error);
      await this.updateOrderStatus(sellerFulfillmentOrderId, "INVENTORY_UNAVAILABLE", error);
      return {
        sellerFulfillmentOrderId,
        sampleRequestId,
        creatorId,
        status: "failed",
        error,
      };
    }

    // ─── Step 2: Get Fulfillment Preview ───
    const previewCheck = traced(
      async () => {
        return this.fulfillmentClient.getFulfillmentPreview({
          address: this.toFulfillmentAddress(job.destinationAddress),
          items: [
            {
              sellerSku: job.sellerSku,
              quantity: job.quantity,
              sellerFulfillmentOrderItemId: `${sellerFulfillmentOrderId}-item-1`,
            },
          ],
          shippingSpeedCategories: [this.config.shippingSpeedCategory],
        });
      },
      { name: "mcf-step-2-fulfillment-preview", runType: "tool" }
    );

    let preview: FulfillmentPreview | null = null;
    try {
      const previewResponse = await previewCheck();
      const previews = previewResponse.payload.fulfillmentPreviews;
      preview = previews.find((p) => p.isFulfillable) ?? null;

      if (!preview) {
        // Check for unfulfillable reasons
        const unfulfillableReasons = previews
          .flatMap((p) => p.unfulfillablePreviewItems ?? [])
          .flatMap((item) => item.itemUnfulfillableReasons ?? []);

        const isAddressIssue = unfulfillableReasons.some(
          (r) => r.toLowerCase().includes("address") || r.toLowerCase().includes("ineligible")
        );

        const errorCode: FulfillmentErrorCode = isAddressIssue
          ? "ADDRESS_INELIGIBLE"
          : "ORDER_UNFULFILLABLE";
        const error = this.buildError(
          "fulfillment_preview",
          errorCode,
          `No fulfillable preview available: ${unfulfillableReasons.join(", ") || "unknown reason"}`,
          false,
          { unfulfillableReasons }
        );
        this.alertAdmin("error", "fulfillment_preview", sellerFulfillmentOrderId, error);
        await this.updateOrderStatus(sellerFulfillmentOrderId, "PREVIEW_FAILED", error);
        return { sellerFulfillmentOrderId, sampleRequestId, creatorId, status: "failed", error };
      }
    } catch (err) {
      const error = this.buildError(
        "fulfillment_preview",
        "API_ERROR",
        (err as Error).message,
        true
      );
      this.alertAdmin("error", "fulfillment_preview", sellerFulfillmentOrderId, error);
      throw error;
    }

    // ─── Step 3: Create Fulfillment Order (Hold + FillOrKill) ───
    const createOrder = traced(
      async () => {
        const destAddr = this.toFulfillmentAddress(job.destinationAddress);
        return this.fulfillmentClient.createFulfillmentOrder({
          sellerFulfillmentOrderId,
          displayableOrderId: sellerFulfillmentOrderId,
          displayableOrderDate: new Date().toISOString(),
          displayableOrderComment:
            job.displayableOrderComment || "TikTok affiliate sample shipment",
          shippingSpeedCategory: this.config.shippingSpeedCategory as "Standard" | "Expedited" | "Priority",
          destinationAddress: destAddr,
          items: [
            {
              sellerSku: job.sellerSku,
              sellerFulfillmentOrderItemId: `${sellerFulfillmentOrderId}-item-1`,
              quantity: job.quantity,
            },
          ],
          fulfillmentAction: "Hold",
          fulfillmentPolicy: "FillOrKill",
        });
      },
      { name: "mcf-step-3-create-order", runType: "tool" }
    );

    try {
      await createOrder();
    } catch (err) {
      const error = this.buildError(
        "create_order",
        "ORDER_REJECTED",
        (err as Error).message,
        true,
        { rawError: (err as Error).message }
      );
      this.alertAdmin("error", "create_order", sellerFulfillmentOrderId, error);
      await this.updateOrderStatus(sellerFulfillmentOrderId, "CREATE_FAILED", error);
      return { sellerFulfillmentOrderId, sampleRequestId, creatorId, status: "failed", error };
    }

    // Update DB: order created on hold
    await this.updateOrderStatus(sellerFulfillmentOrderId, "HOLD");

    // ─── Step 4/5: Schedule Hold → Ship Transition ───
    await this.scheduleHoldToShip({
      sellerFulfillmentOrderId,
      sampleRequestId,
      creatorId,
    });

    return {
      sellerFulfillmentOrderId,
      sampleRequestId,
      creatorId,
      status: "created",
    };
  }

  /**
   * Schedule the hold-to-ship transition via BullMQ delayed job.
   */
  async scheduleHoldToShip(data: HoldToShipJobData): Promise<void> {
    await this.holdToShipQueue.add("hold-to-ship", data, {
      delay: this.config.holdWindowMs,
      jobId: `hold-to-ship-${data.sellerFulfillmentOrderId}`,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  /**
   * Step 5: Transition an order from "Hold" to "Ship".
   * Called by the BullMQ worker after the hold window expires.
   */
  async transitionToShip(data: HoldToShipJobData): Promise<void> {
    const { sellerFulfillmentOrderId, creatorId, sampleRequestId } = data;

    const doTransition = traced(
      async () => {
        // First check current status
        const orderResponse = await this.fulfillmentClient.getFulfillmentOrder(
          sellerFulfillmentOrderId
        );
        const currentStatus = orderResponse.payload.fulfillmentOrder.fulfillmentOrderStatus;

        // If already cancelled, do nothing
        if (currentStatus === "Cancelled") {
          this.alertAdmin("info", "update_order", sellerFulfillmentOrderId, {
            step: "update_order",
            code: "CANCELLATION_NOT_POSSIBLE",
            message: "Order already cancelled, skipping ship transition",
            retryable: false,
          });
          return;
        }

        // Transition to Ship
        await this.fulfillmentClient.updateFulfillmentOrder({
          sellerFulfillmentOrderId,
          fulfillmentAction: "Ship",
        });

        await this.updateOrderStatus(sellerFulfillmentOrderId, "SHIPPING");
      },
      {
        name: "mcf-step-5-hold-to-ship",
        runType: "tool",
        metadata: { orderId: sellerFulfillmentOrderId, creatorId, sampleRequestId },
      }
    );

    try {
      await doTransition();
    } catch (err) {
      const error = this.buildError(
        "update_order",
        "API_ERROR",
        (err as Error).message,
        true
      );
      this.alertAdmin("error", "update_order", sellerFulfillmentOrderId, error);
      throw err;
    }
  }

  /**
   * Cancel a fulfillment order during the hold window.
   * Only works when status is "Received" or "Planning".
   */
  async cancelOrder(sellerFulfillmentOrderId: string): Promise<{
    cancelled: boolean;
    reason?: string;
  }> {
    const doCancel = traced(
      async () => {
        // Check current status first
        const orderResponse = await this.fulfillmentClient.getFulfillmentOrder(
          sellerFulfillmentOrderId
        );
        const currentStatus = orderResponse.payload.fulfillmentOrder.fulfillmentOrderStatus;

        if (!isCancellable(currentStatus)) {
          return {
            cancelled: false,
            reason: `Cannot cancel order in "${currentStatus}" status. Cancellation only allowed in Received or Planning status.`,
          };
        }

        await this.fulfillmentClient.cancelFulfillmentOrder(sellerFulfillmentOrderId);
        await this.updateOrderStatus(sellerFulfillmentOrderId, "Cancelled");

        // Remove the scheduled hold-to-ship job
        const job = await this.holdToShipQueue.getJob(
          `hold-to-ship-${sellerFulfillmentOrderId}`
        );
        if (job) {
          await job.remove();
        }

        return { cancelled: true };
      },
      {
        name: "mcf-step-4-cancel-order",
        runType: "tool",
        metadata: { orderId: sellerFulfillmentOrderId },
      }
    );

    try {
      return await doCancel();
    } catch (err) {
      const error = this.buildError(
        "cancel_order",
        "API_ERROR",
        (err as Error).message,
        true
      );
      this.alertAdmin("error", "cancel_order", sellerFulfillmentOrderId, error);
      throw err;
    }
  }

  /**
   * Steps 7–8: Retrieve tracking details for a fulfilled order.
   * Called after SQS consumer indicates shipment.
   */
  async retrieveTracking(
    sellerFulfillmentOrderId: string,
    creatorId: string
  ): Promise<PackageTrackingDetails | null> {
    const doRetrieveTracking = traced(
      async () => {
        // Step 7: Get fulfillment order to retrieve packageNumber(s)
        const orderResponse = await this.fulfillmentClient.getFulfillmentOrder(
          sellerFulfillmentOrderId
        );

        const packageNumbers = this.extractPackageNumbers(orderResponse);
        if (packageNumbers.length === 0) {
          return null;
        }

        // Step 8: Get tracking details for first package
        const tracking = await this.fulfillmentClient.getPackageTrackingDetails(
          packageNumbers[0]
        );

        // Send tracking to creator through delay layer
        if (tracking.trackingNumber) {
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

          // Update orders table with tracking
          await this.db.query(
            `UPDATE orders
             SET tracking_num = $1, updated_at = NOW()
             WHERE fulfillment_id = $2`,
            [tracking.trackingNumber, sellerFulfillmentOrderId]
          );
        }

        return tracking;
      },
      {
        name: "mcf-steps-7-8-retrieve-tracking",
        runType: "tool",
        metadata: { orderId: sellerFulfillmentOrderId, creatorId },
      }
    );

    try {
      return await doRetrieveTracking();
    } catch (err) {
      const error = this.buildError(
        "get_tracking",
        "TRACKING_UNAVAILABLE",
        (err as Error).message,
        true
      );
      this.alertAdmin("warning", "get_tracking", sellerFulfillmentOrderId, error);
      return null;
    }
  }

  /**
   * Retrieve tracking with retry + exponential backoff.
   * Used when initial tracking retrieval fails.
   */
  async retrieveTrackingWithRetry(
    sellerFulfillmentOrderId: string,
    creatorId: string
  ): Promise<PackageTrackingDetails | null> {
    for (let attempt = 0; attempt < this.config.trackingRetryMax; attempt++) {
      const tracking = await this.retrieveTracking(sellerFulfillmentOrderId, creatorId);
      if (tracking?.trackingNumber) {
        return tracking;
      }

      // Exponential backoff
      const delay = this.config.trackingRetryBaseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // All retries exhausted
    const error = this.buildError(
      "get_tracking",
      "TRACKING_UNAVAILABLE",
      `Tracking unavailable after ${this.config.trackingRetryMax} retries`,
      false
    );
    this.alertAdmin("error", "get_tracking", sellerFulfillmentOrderId, error);
    return null;
  }

  /**
   * Poll fulfillment order status as fallback when SQS is slow.
   */
  async pollOrderStatus(
    sellerFulfillmentOrderId: string
  ): Promise<FulfillmentOrderStatus | null> {
    const doPoll = traced(
      async () => {
        const response = await this.fulfillmentClient.getFulfillmentOrder(
          sellerFulfillmentOrderId
        );
        return response.payload.fulfillmentOrder.fulfillmentOrderStatus;
      },
      {
        name: "mcf-poll-order-status",
        runType: "tool",
        metadata: { orderId: sellerFulfillmentOrderId },
      }
    );

    try {
      return await doPoll();
    } catch (err) {
      this.alertAdmin("warning", "get_fulfillment_order", sellerFulfillmentOrderId, {
        step: "get_fulfillment_order",
        code: "API_ERROR",
        message: (err as Error).message,
        retryable: true,
      });
      return null;
    }
  }

  // ─── Helpers ───

  private extractPackageNumbers(
    response: GetFulfillmentOrderResponse
  ): number[] {
    const packageNumbers: number[] = [];

    for (const shipment of response.payload.fulfillmentShipments) {
      // From shipment packages
      if (shipment.fulfillmentShipmentPackage) {
        for (const pkg of shipment.fulfillmentShipmentPackage) {
          if (pkg.packageNumber && !packageNumbers.includes(pkg.packageNumber)) {
            packageNumbers.push(pkg.packageNumber);
          }
        }
      }
      // From shipment items (fallback)
      for (const item of shipment.fulfillmentShipmentItem) {
        if (
          item.packageNumber &&
          !packageNumbers.includes(item.packageNumber)
        ) {
          packageNumbers.push(item.packageNumber);
        }
      }
    }

    return packageNumbers;
  }

  private buildError(
    step: FulfillmentStep,
    code: FulfillmentErrorCode,
    message: string,
    retryable: boolean,
    details?: unknown
  ): FulfillmentError {
    return { step, code, message, retryable, details };
  }

  private alertAdmin(
    level: "error" | "warning" | "info",
    step: FulfillmentStep,
    orderId: string,
    error: FulfillmentError
  ): void {
    adminAlert({
      level,
      step,
      orderId,
      message: error.message,
      details: error,
    });
  }

  private async updateOrderStatus(
    fulfillmentId: string,
    status: string,
    error?: FulfillmentError
  ): Promise<void> {
    const statusEntry = {
      status,
      updatedAt: new Date().toISOString(),
      error: error || null,
    };

    await this.db.query(
      `UPDATE orders
       SET status = $1,
           status_webhook_log = status_webhook_log || $2::jsonb,
           updated_at = NOW()
       WHERE fulfillment_id = $3`,
      [status, JSON.stringify(statusEntry), fulfillmentId]
    );
  }

  /**
   * Convert an Address (orchestrator format) to FulfillmentAddress (SP-API format).
   */
  private toFulfillmentAddress(addr: Address): FulfillmentAddress {
    return {
      name: addr.name,
      line1: addr.addressLine1,
      line2: addr.addressLine2,
      city: addr.city,
      stateOrRegion: addr.stateOrRegion ?? "",
      postalCode: addr.postalCode,
      countryCode: addr.countryCode,
    };
  }

  /** Expose config for testing */
  getConfig(): Readonly<FulfillmentConfig> {
    return { ...this.config };
  }
}
