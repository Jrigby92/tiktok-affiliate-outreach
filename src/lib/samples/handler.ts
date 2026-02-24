/**
 * Sample Request Handler with 72-Hour Enforcement
 *
 * The agent MUST respond to sample requests within 72 hours
 * via the Manage Samples API.
 *
 * Flow:
 * - Approved → trigger Amazon MCF fulfillment (stubbed for Section 5)
 * - Rejected → log reason, notify creator (through delay layer)
 * - BullMQ scheduled job monitors pending requests and escalates
 *   any approaching the 72-hour deadline
 */

import { Pool } from "pg";
import { Queue, Worker, Job } from "bullmq";
import {
  TikTokApiClient,
  SampleRequest,
  SampleDecision,
} from "@/lib/api/tiktok";
import { InfluencerMessageSender } from "@/lib/messaging/sender";
import { redisConnection } from "@/lib/queue/connection";

/** Hours before deadline to trigger escalation alert */
const ESCALATION_HOURS = 12;

/** How often to check for approaching deadlines (ms) */
const MONITOR_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface SampleApprovalResult {
  requestId: string;
  decision: "approved" | "rejected";
  fulfillmentTriggered: boolean;
  notificationSent: boolean;
}

export interface SampleEscalation {
  requestId: string;
  creatorHandle: string;
  productId: string;
  hoursRemaining: number;
  deadlineAt: Date;
}

/** Callback type for Amazon MCF fulfillment (stubbed for Section 5) */
export type FulfillmentTrigger = (
  requestId: string,
  creatorId: string,
  productId: string,
  shippingAddress: SampleRequest["shippingAddress"]
) => Promise<{ fulfillmentId: string }>;

/**
 * Default fulfillment stub — replaced by Section 5 when MCF is wired.
 */
const defaultFulfillmentStub: FulfillmentTrigger = async (
  requestId,
  _creatorId,
  _productId,
  _address
) => {
  console.log(`[STUB] MCF fulfillment triggered for sample ${requestId}`);
  return { fulfillmentId: `stub_${requestId}_${Date.now()}` };
};

export class SampleRequestHandler {
  private tiktokClient: TikTokApiClient;
  private messageSender: InfluencerMessageSender;
  private db: Pool;
  private fulfillmentTrigger: FulfillmentTrigger;
  private monitorWorker: Worker | null = null;
  private monitorQueue: Queue;

  /** Callback for escalation alerts (admin dashboard, Slack, etc.) */
  onEscalation?: (escalations: SampleEscalation[]) => void;

  constructor(
    tiktokClient: TikTokApiClient,
    messageSender: InfluencerMessageSender,
    db: Pool,
    fulfillmentTrigger?: FulfillmentTrigger
  ) {
    this.tiktokClient = tiktokClient;
    this.messageSender = messageSender;
    this.db = db;
    this.fulfillmentTrigger = fulfillmentTrigger || defaultFulfillmentStub;
    this.monitorQueue = new Queue("sample-deadline-monitor", {
      connection: redisConnection,
    });
  }

  /**
   * Process a sample decision (approve or reject).
   *
   * - Validates the request exists and is within the 72-hour window
   * - Calls the TikTok Manage Samples API
   * - If approved: triggers Amazon MCF fulfillment (stubbed)
   * - Notifies the creator through the delay layer
   */
  async processSampleDecision(
    decision: SampleDecision
  ): Promise<SampleApprovalResult> {
    // Get the sample request details
    const request = await this.tiktokClient.getSampleRequest(
      decision.requestId
    );

    // Verify within 72-hour window
    const now = new Date();
    const deadline = new Date(request.deadlineAt);
    if (now > deadline) {
      throw new Error(
        `Sample request ${decision.requestId} has exceeded the 72-hour deadline ` +
          `(deadline: ${deadline.toISOString()}, now: ${now.toISOString()})`
      );
    }

    // Submit decision to TikTok
    await this.tiktokClient.decideSample(decision);

    let fulfillmentTriggered = false;

    // If approved, trigger fulfillment
    if (decision.decision === "approve" && request.shippingAddress) {
      try {
        const fulfillmentResult = await this.fulfillmentTrigger(
          request.requestId,
          request.creatorId,
          request.productId,
          request.shippingAddress
        );

        // Log to orders table
        await this.db.query(
          `INSERT INTO orders (fulfillment_id, pii_data, status, status_webhook_log)
           VALUES ($1, $2, 'PENDING', $3)`,
          [
            fulfillmentResult.fulfillmentId,
            JSON.stringify({
              name: request.shippingAddress.name,
              address: request.shippingAddress.address,
              city: request.shippingAddress.city,
              postcode: request.shippingAddress.postcode,
              country: request.shippingAddress.country,
              phone: request.shippingAddress.phone,
              region: request.shippingAddress.city, // anonymized geo kept after PII scrub
              product_id: request.productId,
            }),
            JSON.stringify({
              sample_request_id: request.requestId,
              creator_id: request.creatorId,
              triggered_at: now.toISOString(),
            }),
          ]
        );

        fulfillmentTriggered = true;
      } catch (error) {
        console.error(
          `Fulfillment failed for sample ${decision.requestId}:`,
          error
        );
      }
    }

    // Notify creator through delay layer
    let notificationSent = false;
    try {
      await this.messageSender.sendSampleNotification({
        requestId: request.requestId,
        creatorId: request.creatorId,
        decision: decision.decision === "approve" ? "approved" : "rejected",
        reason: decision.reason,
        productId: request.productId,
      });
      notificationSent = true;
    } catch (error) {
      console.error(
        `Notification failed for sample ${decision.requestId}:`,
        error
      );
    }

    // Store decision in local DB
    await this.db.query(
      `INSERT INTO sample_decisions
       (request_id, creator_id, product_id, decision, reason, fulfillment_triggered, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (request_id) DO UPDATE SET
         decision = EXCLUDED.decision,
         reason = EXCLUDED.reason,
         fulfillment_triggered = EXCLUDED.fulfillment_triggered,
         decided_at = EXCLUDED.decided_at`,
      [
        request.requestId,
        request.creatorId,
        request.productId,
        decision.decision,
        decision.reason || null,
        fulfillmentTriggered,
        now,
      ]
    );

    return {
      requestId: decision.requestId,
      decision: decision.decision === "approve" ? "approved" : "rejected",
      fulfillmentTriggered,
      notificationSent,
    };
  }

  /**
   * Check for sample requests approaching their 72-hour deadline.
   * Returns escalations for requests within ESCALATION_HOURS of deadline.
   */
  async checkDeadlines(): Promise<SampleEscalation[]> {
    const pendingRequests =
      await this.tiktokClient.listAllSampleRequests("pending");

    const now = new Date();
    const escalations: SampleEscalation[] = [];

    for (const request of pendingRequests) {
      const deadlineDate = new Date(request.deadlineAt);
      const hoursRemaining =
        (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursRemaining <= ESCALATION_HOURS && hoursRemaining > 0) {
        escalations.push({
          requestId: request.requestId,
          creatorHandle: request.creatorHandle,
          productId: request.productId,
          hoursRemaining: Math.round(hoursRemaining * 10) / 10,
          deadlineAt: deadlineDate,
        });
      }
    }

    if (escalations.length > 0 && this.onEscalation) {
      this.onEscalation(escalations);
    }

    return escalations;
  }

  /**
   * Start the deadline monitoring worker.
   * Runs on a recurring schedule to check for approaching deadlines.
   */
  async startMonitor(): Promise<void> {
    // Add a recurring job
    await this.monitorQueue.add(
      "check-deadlines",
      {},
      {
        repeat: {
          every: MONITOR_INTERVAL_MS,
        },
      }
    );

    this.monitorWorker = new Worker(
      "sample-deadline-monitor",
      async (_job: Job) => {
        const escalations = await this.checkDeadlines();
        return { escalations: escalations.length };
      },
      { connection: redisConnection }
    );
  }

  /**
   * Stop the deadline monitoring worker.
   */
  async stopMonitor(): Promise<void> {
    if (this.monitorWorker) {
      await this.monitorWorker.close();
      this.monitorWorker = null;
    }
    await this.monitorQueue.close();
  }

  /**
   * Set the fulfillment trigger (called by Section 5 to wire real MCF).
   */
  setFulfillmentTrigger(trigger: FulfillmentTrigger): void {
    this.fulfillmentTrigger = trigger;
  }
}
