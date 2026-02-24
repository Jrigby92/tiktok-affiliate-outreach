/**
 * Fulfillment Orchestrator Types
 *
 * Types for the 8-step Amazon MCF fulfillment sequence.
 */

import { Address, FulfillmentOrderStatus } from "@/lib/api/amazon/types";

// ─── Job Types ───

export interface FulfillmentJobData {
  /** Unique order ID (e.g., "ANDINN-SR-{requestId}-{timestamp}") */
  sellerFulfillmentOrderId: string;
  /** TikTok sample request ID that triggered this fulfillment */
  sampleRequestId: string;
  /** Creator ID (TikTok) */
  creatorId: string;
  /** Product SKU in Amazon FBA */
  sellerSku: string;
  /** Quantity to ship */
  quantity: number;
  /** Destination address */
  destinationAddress: Address;
  /** Display comment for the order */
  displayableOrderComment?: string;
}

export interface HoldToShipJobData {
  sellerFulfillmentOrderId: string;
  sampleRequestId: string;
  creatorId: string;
}

// ─── Orchestrator Result ───

export interface FulfillmentResult {
  sellerFulfillmentOrderId: string;
  sampleRequestId: string;
  creatorId: string;
  status: "created" | "shipped" | "tracking_sent" | "failed";
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
  error?: FulfillmentError;
}

// ─── Error Types ───

export type FulfillmentStep =
  | "inventory_check"
  | "fulfillment_preview"
  | "create_order"
  | "cancel_order"
  | "update_order"
  | "sqs_processing"
  | "get_fulfillment_order"
  | "get_tracking"
  | "notify_creator";

export interface FulfillmentError {
  step: FulfillmentStep;
  code: FulfillmentErrorCode;
  message: string;
  details?: unknown;
  retryable: boolean;
}

export type FulfillmentErrorCode =
  | "INVENTORY_UNAVAILABLE"
  | "ADDRESS_INELIGIBLE"
  | "ORDER_REJECTED"
  | "ORDER_UNFULFILLABLE"
  | "SQS_TIMEOUT"
  | "TRACKING_UNAVAILABLE"
  | "RATE_LIMITED"
  | "CANCELLATION_NOT_POSSIBLE"
  | "API_ERROR"
  | "UNKNOWN_ERROR";

// ─── Configuration ───

export interface FulfillmentConfig {
  /** Hold window duration in milliseconds (default: 2 hours) */
  holdWindowMs: number;
  /** Shipping speed category (default: "Standard") */
  shippingSpeedCategory: string;
  /** Max retries for tracking retrieval */
  trackingRetryMax: number;
  /** Backoff base delay for tracking retries (ms) */
  trackingRetryBaseDelayMs: number;
  /** Timeout for waiting on SQS status notification (ms) */
  sqsStatusTimeoutMs: number;
  /** Polling interval for getFulfillmentOrder when SQS is slow (ms) */
  pollingIntervalMs: number;
  /** Max polling attempts */
  maxPollingAttempts: number;
}

export const DEFAULT_FULFILLMENT_CONFIG: FulfillmentConfig = {
  holdWindowMs: 2 * 60 * 60 * 1000, // 2 hours
  shippingSpeedCategory: "Standard",
  trackingRetryMax: 5,
  trackingRetryBaseDelayMs: 30_000, // 30 seconds
  sqsStatusTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  pollingIntervalMs: 5 * 60 * 1000, // 5 minutes
  maxPollingAttempts: 20,
};

// ─── Cancellation ───

/** Statuses where cancellation is allowed */
export const CANCELLABLE_STATUSES: FulfillmentOrderStatus[] = [
  "Received",
  "Planning",
];

export function isCancellable(status: FulfillmentOrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}
