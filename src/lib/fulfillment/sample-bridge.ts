/**
 * Sample Approval → Fulfillment Bridge
 *
 * Replaces the stub from Section 4.5 by wiring the sample handler's
 * FulfillmentTrigger callback to the real MCF orchestrator.
 *
 * When a TikTok sample request is approved, this bridge:
 * 1. Maps the TikTok shipping address to an Amazon Address
 * 2. Generates a unique fulfillment order ID
 * 3. Enqueues a fulfillment job via BullMQ
 * 4. Returns the fulfillment ID to the sample handler
 */

import { Queue } from "bullmq";
import { redisConnection } from "@/lib/queue/connection";
import { QUEUE_NAMES } from "@/lib/queue/queues";
import { Address } from "@/lib/api/amazon/types";
import { SampleRequest } from "@/lib/api/tiktok";
import { FulfillmentTrigger } from "@/lib/samples/handler";
import { FulfillmentJobData } from "./types";

/** Map from product IDs to Amazon SKUs. In production, this comes from the DB. */
export type SkuResolver = (productId: string) => Promise<string>;

/** Default SKU resolver — uses product ID as SKU */
const defaultSkuResolver: SkuResolver = async (productId: string) => productId;

/**
 * Create the real FulfillmentTrigger that replaces the Section 4 stub.
 */
export function createFulfillmentTrigger(
  skuResolver?: SkuResolver
): FulfillmentTrigger {
  const fulfillmentQueue = new Queue(QUEUE_NAMES.FULFILLMENT, {
    connection: redisConnection,
  });
  const resolver = skuResolver || defaultSkuResolver;

  return async (
    requestId: string,
    creatorId: string,
    productId: string,
    shippingAddress: SampleRequest["shippingAddress"]
  ): Promise<{ fulfillmentId: string }> => {
    if (!shippingAddress) {
      throw new Error(`No shipping address provided for sample request ${requestId}`);
    }

    const sellerSku = await resolver(productId);
    const sellerFulfillmentOrderId = `ANDINN-SR-${requestId}-${Date.now()}`;

    const destinationAddress: Address = {
      name: shippingAddress.name,
      addressLine1: shippingAddress.address,
      city: shippingAddress.city,
      postalCode: shippingAddress.postcode,
      countryCode: shippingAddress.country === "UK" ? "GB" : shippingAddress.country,
      phone: shippingAddress.phone,
    };

    const jobData: FulfillmentJobData = {
      sellerFulfillmentOrderId,
      sampleRequestId: requestId,
      creatorId,
      sellerSku,
      quantity: 1,
      destinationAddress,
      displayableOrderComment: `TikTok sample for creator ${creatorId}`,
    };

    // Enqueue for async processing by the fulfillment worker
    await fulfillmentQueue.add("process-fulfillment", jobData, {
      jobId: sellerFulfillmentOrderId,
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { fulfillmentId: sellerFulfillmentOrderId };
  };
}
