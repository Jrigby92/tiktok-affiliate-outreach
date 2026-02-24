/**
 * Fulfillment BullMQ Worker
 *
 * Processes fulfillment jobs:
 * - "hold-to-ship": Transitions orders from Hold to Ship after the cancellation window
 * - "process-fulfillment": Executes the full 8-step MCF sequence
 */

import { Worker, Job } from "bullmq";
import { Pool } from "pg";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { FbaInventoryClient } from "@/lib/api/amazon/fba-inventory";
import { FulfillmentOutboundClient } from "@/lib/api/amazon/fulfillment-outbound";
import { InfluencerMessageSender } from "@/lib/messaging/sender";
import { FulfillmentOrchestrator } from "./orchestrator";
import { FulfillmentJobData, HoldToShipJobData, FulfillmentConfig } from "./types";

export class FulfillmentWorker {
  private worker: Worker | null = null;
  private orchestrator: FulfillmentOrchestrator;

  constructor(
    inventoryClient: FbaInventoryClient,
    fulfillmentClient: FulfillmentOutboundClient,
    messageSender: InfluencerMessageSender,
    db: Pool,
    config?: Partial<FulfillmentConfig>
  ) {
    this.orchestrator = new FulfillmentOrchestrator(
      inventoryClient,
      fulfillmentClient,
      messageSender,
      db,
      config
    );
  }

  /**
   * Start the fulfillment worker.
   */
  start(): Worker {
    this.worker = new Worker(
      QUEUE_NAMES.FULFILLMENT,
      async (job: Job) => {
        switch (job.name) {
          case "process-fulfillment":
            return this.handleFulfillment(job.data as FulfillmentJobData);
          case "hold-to-ship":
            return this.handleHoldToShip(job.data as HoldToShipJobData);
          default:
            throw new Error(`Unknown fulfillment job type: ${job.name}`);
        }
      },
      {
        connection: redisConnection,
        concurrency: 5,
      }
    );

    this.worker.on("completed", (job) => {
      console.log(`[FulfillmentWorker] Job ${job.name}/${job.id} completed`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(
        `[FulfillmentWorker] Job ${job?.name}/${job?.id} failed:`,
        err.message
      );
    });

    return this.worker;
  }

  private async handleFulfillment(data: FulfillmentJobData) {
    return this.orchestrator.executeFulfillment(data);
  }

  private async handleHoldToShip(data: HoldToShipJobData) {
    return this.orchestrator.transitionToShip(data);
  }

  /**
   * Get the orchestrator instance (for direct invocation / testing).
   */
  getOrchestrator(): FulfillmentOrchestrator {
    return this.orchestrator;
  }

  /**
   * Stop the worker gracefully.
   */
  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
