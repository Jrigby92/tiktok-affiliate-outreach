/**
 * Fulfillment Orchestrator — End-to-End Tests
 *
 * Full pipeline with mocked SP-API:
 * - Sample approved → inventory check → preview → create (hold, FillOrKill)
 *   → [window] → ship → SQS message → getFulfillmentOrder (packageNumber)
 *   → getPackageTrackingDetails → creator notified (with delay)
 *
 * Failure paths:
 * - Inventory unavailable halts sequence
 * - Address ineligible triggers manual fallback
 * - Order creation fails
 * - Cancellation during hold window works
 * - Cancellation after ship rejected
 * - Tracking unavailable with retry
 * - SQS processor updates orders + notifies creator
 */

import { FulfillmentOrchestrator, setAdminAlert } from "@/lib/fulfillment/orchestrator";
import { FulfillmentSqsProcessor } from "@/lib/fulfillment/sqs-processor";
import { createFulfillmentTrigger } from "@/lib/fulfillment/sample-bridge";
import { isCancellable } from "@/lib/fulfillment/types";
import { Pool } from "pg";
import { FulfillmentJobData } from "@/lib/fulfillment/types";

// ─── Mocks ───

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: "test-job-id" }),
    getJob: jest.fn().mockResolvedValue({
      remove: jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("@/lib/queue/connection", () => ({
  redisConnection: { host: "localhost", port: 6379 },
  getRedisConnection: jest.fn().mockReturnValue({ host: "localhost", port: 6379 }),
}));

jest.mock("@/lib/queue/queues", () => ({
  QUEUE_NAMES: {
    FULFILLMENT: "fulfillment",
    CREATOR_DISCOVERY: "creator-discovery",
    SQS_CONSUMER: "sqs-consumer",
    TREND_INGESTION: "trend-ingestion",
    CONTENT_BRIEF: "content-brief",
    COMPLIANCE_CHECK: "compliance-check",
  },
}));

jest.mock("langsmith/traceable", () => ({
  traceable: jest.fn((fn: unknown) => fn),
}));

jest.mock("langsmith/wrappers", () => ({
  wrapOpenAI: jest.fn((client: unknown) => client),
}));

jest.mock("@/lib/llm/langsmith", () => ({
  traced: jest.fn((fn: unknown) => fn),
  wrapOpenAI: jest.fn((client: unknown) => client),
}));

const mockDbQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockDb = { query: mockDbQuery } as unknown as Pool;

const mockAdminAlert = jest.fn();

// ─── Mock Clients ───

function createMockInventoryClient() {
  return {
    checkSkuAvailability: jest.fn(),
  };
}

function createMockFulfillmentClient() {
  return {
    getFulfillmentPreview: jest.fn(),
    createFulfillmentOrder: jest.fn(),
    cancelFulfillmentOrder: jest.fn(),
    updateFulfillmentOrder: jest.fn(),
    getFulfillmentOrder: jest.fn(),
    getPackageTrackingDetails: jest.fn(),
    listAllFulfillmentOrders: jest.fn(),
    createFulfillmentReturn: jest.fn(),
    listReturnReasonCodes: jest.fn(),
  };
}

function createMockMessageSender() {
  return {
    send: jest.fn().mockResolvedValue({
      messageId: "msg_test",
      type: "tracking_update",
      recipientId: "creator-456",
      content: "test",
      actualDelayMs: 0,
      scheduledAt: new Date(),
      deliverAt: new Date(),
    }),
    sendCollaborationInvitation: jest.fn().mockResolvedValue(undefined),
    sendSampleNotification: jest.fn().mockResolvedValue(undefined),
    sendTrackingNotification: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Test Data ───

const TEST_JOB: FulfillmentJobData = {
  sellerFulfillmentOrderId: "ANDINN-SR-test123-1708000000000",
  sampleRequestId: "test123",
  creatorId: "creator-456",
  sellerSku: "VIT-D-001",
  quantity: 1,
  destinationAddress: {
    name: "Test Creator",
    addressLine1: "123 Creator Lane",
    city: "London",
    postalCode: "SW1A 1AA",
    countryCode: "GB",
    phone: "07700900000",
  },
};

// ─── Test Suite ───

describe("FulfillmentOrchestrator", () => {
  let orchestrator: FulfillmentOrchestrator;
  let mockInventoryClient: ReturnType<typeof createMockInventoryClient>;
  let mockFulfillmentClient: ReturnType<typeof createMockFulfillmentClient>;
  let mockMessageSender: ReturnType<typeof createMockMessageSender>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockInventoryClient = createMockInventoryClient();
    mockFulfillmentClient = createMockFulfillmentClient();
    mockMessageSender = createMockMessageSender();

    orchestrator = new FulfillmentOrchestrator(
      mockInventoryClient as never,
      mockFulfillmentClient as never,
      mockMessageSender as never,
      mockDb,
      { holdWindowMs: 1000 } // Short window for tests
    );

    setAdminAlert(mockAdminAlert);
  });

  // ─── Happy Path: Full 8-Step Sequence ───

  describe("Full 8-step MCF sequence", () => {
    it("executes steps 1-3 and schedules hold-to-ship", async () => {
      // Step 1: Inventory check — available
      mockInventoryClient.checkSkuAvailability.mockResolvedValueOnce({
        available: true,
        quantity: 80,
      });

      // Step 2: Fulfillment preview — fulfillable
      mockFulfillmentClient.getFulfillmentPreview.mockResolvedValueOnce({
        payload: {
          fulfillmentPreviews: [
            {
              shippingSpeedCategory: "Standard",
              isFulfillable: true,
              isCODCapable: false,
              fulfillmentPreviewShipments: [],
              unfulfillablePreviewItems: [],
            },
          ],
        },
      });

      // Step 3: Create order
      mockFulfillmentClient.createFulfillmentOrder.mockResolvedValueOnce(undefined);

      const result = await orchestrator.executeFulfillment(TEST_JOB);

      expect(result.status).toBe("created");
      expect(result.sellerFulfillmentOrderId).toBe(TEST_JOB.sellerFulfillmentOrderId);
      expect(result.creatorId).toBe(TEST_JOB.creatorId);
      expect(result.error).toBeUndefined();

      // Verify DB was updated (order created on hold)
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE orders"),
        expect.arrayContaining(["HOLD"])
      );

      // Verify the 3 client calls were made
      expect(mockInventoryClient.checkSkuAvailability).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.getFulfillmentPreview).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.createFulfillmentOrder).toHaveBeenCalledTimes(1);

      // Step 3: verify Hold + FillOrKill
      const createCall = mockFulfillmentClient.createFulfillmentOrder.mock.calls[0][0];
      expect(createCall.fulfillmentAction).toBe("Hold");
      expect(createCall.fulfillmentPolicy).toBe("FillOrKill");
    });

    it("step 5: transitions from hold to ship", async () => {
      // getFulfillmentOrder to check status
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Received",
            fulfillmentAction: "Hold",
            fulfillmentPolicy: "FillOrKill",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [],
        },
      });

      // updateFulfillmentOrder
      mockFulfillmentClient.updateFulfillmentOrder.mockResolvedValueOnce(undefined);

      await orchestrator.transitionToShip({
        sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
        sampleRequestId: TEST_JOB.sampleRequestId,
        creatorId: TEST_JOB.creatorId,
      });

      // Verify update call
      expect(mockFulfillmentClient.updateFulfillmentOrder).toHaveBeenCalled();

      // Verify DB updated
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE orders"),
        expect.arrayContaining(["SHIPPING"])
      );
    });

    it("steps 7-8: retrieves tracking and notifies creator", async () => {
      // getFulfillmentOrder (step 7)
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Complete",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [
            {
              amazonShipmentId: "SHIP-001",
              fulfillmentCenterId: "FC-1",
              fulfillmentShipmentStatus: "SHIPPED",
              fulfillmentShipmentItem: [
                { sellerSku: "VIT-D-001", quantity: 1, packageNumber: 12345 },
              ],
              fulfillmentShipmentPackage: [
                { packageNumber: 12345, carrierCode: "ROYAL_MAIL", trackingNumber: "RM123456789GB" },
              ],
            },
          ],
        },
      });

      // getPackageTrackingDetails (step 8)
      mockFulfillmentClient.getPackageTrackingDetails.mockResolvedValueOnce({
        packageNumber: 12345,
        trackingNumber: "RM123456789GB",
        carrierCode: "ROYAL_MAIL",
        estimatedArrivalDate: "2026-03-01T00:00:00Z",
      });

      const tracking = await orchestrator.retrieveTracking(
        TEST_JOB.sellerFulfillmentOrderId,
        TEST_JOB.creatorId
      );

      expect(tracking).not.toBeNull();
      expect(tracking?.trackingNumber).toBe("RM123456789GB");
      expect(tracking?.carrierCode).toBe("ROYAL_MAIL");

      // Verify DB was updated with tracking
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("tracking_num"),
        expect.arrayContaining(["RM123456789GB", TEST_JOB.sellerFulfillmentOrderId])
      );

      // Verify send was called with tracking_update type
      expect(mockMessageSender.send).toHaveBeenCalledWith(
        "tracking_update",
        TEST_JOB.creatorId,
        expect.stringContaining("RM123456789GB"),
      );
    });
  });

  // ─── Failure: Inventory Unavailable ───

  describe("Inventory unavailable", () => {
    it("halts the sequence and returns failed result", async () => {
      // checkSkuAvailability returns falsy (null/undefined/false)
      mockInventoryClient.checkSkuAvailability.mockResolvedValueOnce(null);

      const result = await orchestrator.executeFulfillment(TEST_JOB);

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("INVENTORY_UNAVAILABLE");
      expect(result.error?.step).toBe("inventory_check");
      expect(result.error?.retryable).toBe(false);

      // Only inventory check, no preview or create
      expect(mockInventoryClient.checkSkuAvailability).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.getFulfillmentPreview).not.toHaveBeenCalled();

      // Admin alerted
      expect(mockAdminAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          step: "inventory_check",
        })
      );

      // DB updated with error status
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE orders"),
        expect.arrayContaining(["INVENTORY_UNAVAILABLE"])
      );
    });
  });

  // ─── Failure: Address Ineligible ───

  describe("Address ineligible", () => {
    it("halts sequence with ADDRESS_INELIGIBLE error", async () => {
      // Step 1: inventory available
      mockInventoryClient.checkSkuAvailability.mockResolvedValueOnce({
        available: true,
        quantity: 80,
      });

      // Step 2: preview — not fulfillable
      mockFulfillmentClient.getFulfillmentPreview.mockResolvedValueOnce({
        payload: {
          fulfillmentPreviews: [
            {
              shippingSpeedCategory: "Standard",
              isFulfillable: false,
              isCODCapable: false,
              fulfillmentPreviewShipments: [],
              unfulfillablePreviewItems: [
                {
                  sellerSku: "VIT-D-001",
                  quantity: 1,
                  sellerFulfillmentOrderItemId: "item-1",
                  itemUnfulfillableReasons: ["Address is ineligible for delivery"],
                },
              ],
            },
          ],
        },
      });

      const result = await orchestrator.executeFulfillment(TEST_JOB);

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("ADDRESS_INELIGIBLE");
      expect(result.error?.step).toBe("fulfillment_preview");

      // Only inventory + preview, no create
      expect(mockInventoryClient.checkSkuAvailability).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.getFulfillmentPreview).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.createFulfillmentOrder).not.toHaveBeenCalled();

      // Admin alerted
      expect(mockAdminAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          step: "fulfillment_preview",
        })
      );
    });
  });

  // ─── Failure: Order Rejected ───

  describe("Order rejected by Amazon", () => {
    it("halts sequence with ORDER_REJECTED error", async () => {
      mockInventoryClient.checkSkuAvailability.mockResolvedValueOnce({
        available: true,
        quantity: 80,
      });

      mockFulfillmentClient.getFulfillmentPreview.mockResolvedValueOnce({
        payload: {
          fulfillmentPreviews: [
            {
              shippingSpeedCategory: "Standard",
              isFulfillable: true,
              fulfillmentPreviewShipments: [],
              unfulfillablePreviewItems: [],
            },
          ],
        },
      });

      mockFulfillmentClient.createFulfillmentOrder.mockRejectedValueOnce(
        new Error("Bad address")
      );

      const result = await orchestrator.executeFulfillment(TEST_JOB);

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("ORDER_REJECTED");
      expect(result.error?.step).toBe("create_order");

      expect(mockAdminAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          step: "create_order",
        })
      );
    });
  });

  // ─── Cancellation During Hold Window ───

  describe("Cancellation during hold window", () => {
    it("cancels when status is Received", async () => {
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Received",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [],
        },
      });
      mockFulfillmentClient.cancelFulfillmentOrder.mockResolvedValueOnce(undefined);

      const result = await orchestrator.cancelOrder(TEST_JOB.sellerFulfillmentOrderId);

      expect(result.cancelled).toBe(true);
      expect(result.reason).toBeUndefined();

      // Verify DB updated to Cancelled
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE orders"),
        expect.arrayContaining(["Cancelled"])
      );
    });

    it("cancels when status is Planning", async () => {
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Planning",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [],
        },
      });
      mockFulfillmentClient.cancelFulfillmentOrder.mockResolvedValueOnce(undefined);

      const result = await orchestrator.cancelOrder(TEST_JOB.sellerFulfillmentOrderId);
      expect(result.cancelled).toBe(true);
    });

    it("rejects cancellation when status is Processing (after ship)", async () => {
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Processing",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [],
        },
      });

      const result = await orchestrator.cancelOrder(TEST_JOB.sellerFulfillmentOrderId);

      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain("Processing");
      expect(result.reason).toContain("only allowed in Received or Planning");

      // Only 1 call (status check, no cancel attempted)
      expect(mockFulfillmentClient.getFulfillmentOrder).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.cancelFulfillmentOrder).not.toHaveBeenCalled();
    });

    it("rejects cancellation when status is Complete", async () => {
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Complete",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [],
        },
      });

      const result = await orchestrator.cancelOrder(TEST_JOB.sellerFulfillmentOrderId);

      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain("Complete");
    });
  });

  // ─── Hold-to-Ship Transition ───

  describe("Hold to Ship transition", () => {
    it("skips ship transition if order already cancelled", async () => {
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Cancelled",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [],
        },
      });

      await orchestrator.transitionToShip({
        sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
        sampleRequestId: TEST_JOB.sampleRequestId,
        creatorId: TEST_JOB.creatorId,
      });

      // Only 1 call (status check), no update call
      expect(mockFulfillmentClient.getFulfillmentOrder).toHaveBeenCalledTimes(1);
      expect(mockFulfillmentClient.updateFulfillmentOrder).not.toHaveBeenCalled();

      // Admin notified (info level)
      expect(mockAdminAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "info",
          step: "update_order",
        })
      );
    });
  });

  // ─── Tracking Unavailable ───

  describe("Tracking unavailable", () => {
    it("returns null when no packageNumbers found", async () => {
      mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
        payload: {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: TEST_JOB.sellerFulfillmentOrderId,
            fulfillmentOrderStatus: "Complete",
          },
          fulfillmentOrderItems: [],
          fulfillmentShipments: [], // no packages
        },
      });

      const tracking = await orchestrator.retrieveTracking(
        TEST_JOB.sellerFulfillmentOrderId,
        TEST_JOB.creatorId
      );

      expect(tracking).toBeNull();
    });
  });

  // ─── isCancellable Helper ───

  describe("isCancellable", () => {
    it("returns true for Received and Planning", () => {
      expect(isCancellable("Received")).toBe(true);
      expect(isCancellable("Planning")).toBe(true);
    });

    it("returns false for other statuses", () => {
      expect(isCancellable("Processing")).toBe(false);
      expect(isCancellable("Complete")).toBe(false);
      expect(isCancellable("Cancelled")).toBe(false);
      expect(isCancellable("Unfulfillable")).toBe(false);
    });
  });

  // ─── Config ───

  describe("Configuration", () => {
    it("uses default config", () => {
      const defaultOrchestrator = new FulfillmentOrchestrator(
        mockInventoryClient as never,
        mockFulfillmentClient as never,
        mockMessageSender as never,
        mockDb
      );
      const config = defaultOrchestrator.getConfig();
      expect(config.holdWindowMs).toBe(2 * 60 * 60 * 1000);
      expect(config.shippingSpeedCategory).toBe("Standard");
      expect(config.trackingRetryMax).toBe(5);
    });

    it("allows custom config overrides", () => {
      const config = orchestrator.getConfig();
      expect(config.holdWindowMs).toBe(1000);
    });
  });
});

// ─── SQS Message Processor Tests ───

describe("FulfillmentSqsProcessor", () => {
  let processor: FulfillmentSqsProcessor;
  let mockFulfillmentClient: ReturnType<typeof createMockFulfillmentClient>;
  let mockMessageSender: ReturnType<typeof createMockMessageSender>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFulfillmentClient = createMockFulfillmentClient();
    mockMessageSender = createMockMessageSender();

    processor = new FulfillmentSqsProcessor(
      mockFulfillmentClient as never,
      mockMessageSender as never,
      mockDb
    );
  });

  it("updates orders table on status notification", async () => {
    const notification = {
      notificationType: "FULFILLMENT_ORDER_STATUS",
      payload: {
        sellerFulfillmentOrderId: "ANDINN-SR-test123",
        fulfillmentOrderStatus: "Processing" as const,
        statusUpdatedDate: "2026-02-24T12:00:00Z",
      },
    };

    // No shipment yet, so no tracking retrieval
    await processor.processStatusUpdate(notification);

    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE orders"),
      expect.arrayContaining(["Processing"])
    );
  });

  it("retrieves tracking and notifies creator when order completes", async () => {
    // Mock DB returns order with creator_id
    mockDbQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE orders (status)
      .mockResolvedValueOnce({
        rows: [
          {
            pii_data: { name: "Test", product_id: "prod-1" },
            status_webhook_log: [{ creator_id: "creator-456" }],
          },
        ],
        rowCount: 1,
      }) // SELECT for creator_id
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE tracking_num

    // getFulfillmentOrder returns packageNumbers
    mockFulfillmentClient.getFulfillmentOrder.mockResolvedValueOnce({
      payload: {
        fulfillmentOrder: {
          sellerFulfillmentOrderId: "ANDINN-SR-test123",
          fulfillmentOrderStatus: "Complete",
        },
        fulfillmentOrderItems: [],
        fulfillmentShipments: [
          {
            amazonShipmentId: "SHIP-001",
            fulfillmentCenterId: "FC-1",
            fulfillmentShipmentStatus: "SHIPPED",
            fulfillmentShipmentItem: [
              { sellerSku: "VIT-D-001", quantity: 1, packageNumber: 99999 },
            ],
            fulfillmentShipmentPackage: [
              { packageNumber: 99999, carrierCode: "DPD", trackingNumber: "DPD12345UK" },
            ],
          },
        ],
      },
    });

    // getPackageTrackingDetails
    mockFulfillmentClient.getPackageTrackingDetails.mockResolvedValueOnce({
      packageNumber: 99999,
      trackingNumber: "DPD12345UK",
      carrierCode: "DPD",
      estimatedArrivalDate: "2026-03-02T00:00:00Z",
    });

    const notification = {
      notificationType: "FULFILLMENT_ORDER_STATUS",
      payload: {
        sellerFulfillmentOrderId: "ANDINN-SR-test123",
        fulfillmentOrderStatus: "Complete" as const,
        statusUpdatedDate: "2026-02-25T14:00:00Z",
      },
    };

    await processor.processStatusUpdate(notification);

    // Verify tracking was stored in DB
    const trackingUpdateCall = mockDbQuery.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).includes("tracking_num") &&
        Array.isArray(call[1]) &&
        (call[1] as unknown[]).includes("DPD12345UK")
    );
    expect(trackingUpdateCall).toBeDefined();

    // Verify creator was notified through the message sender
    expect(mockMessageSender.send).toHaveBeenCalledWith(
      "tracking_update",
      "creator-456",
      expect.stringContaining("DPD12345UK"),
    );
  });

  it("handles missing order gracefully", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE status
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT returns nothing

    const notification = {
      notificationType: "FULFILLMENT_ORDER_STATUS",
      payload: {
        sellerFulfillmentOrderId: "NONEXISTENT",
        fulfillmentOrderStatus: "Complete" as const,
        statusUpdatedDate: "2026-02-25T14:00:00Z",
      },
    };

    // Should not throw
    await processor.processStatusUpdate(notification);

    // No API calls for tracking since order not found
    expect(mockFulfillmentClient.getFulfillmentOrder).not.toHaveBeenCalled();
  });
});

// ─── Sample Bridge Tests ───

describe("createFulfillmentTrigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a fulfillment trigger that enqueues jobs", async () => {
    const trigger = createFulfillmentTrigger();
    const result = await trigger(
      "sample-req-001",
      "creator-789",
      "VIT-D-001",
      {
        name: "Test Creator",
        address: "123 Test St",
        city: "London",
        postcode: "SW1A 1AA",
        country: "GB",
        phone: "07700900000",
      }
    );

    expect(result.fulfillmentId).toMatch(/^ANDINN-SR-sample-req-001-/);
  });

  it("uses custom SKU resolver", async () => {
    const customResolver = jest.fn().mockResolvedValue("CUSTOM-SKU-001");
    const trigger = createFulfillmentTrigger(customResolver);

    await trigger(
      "sample-req-002",
      "creator-101",
      "product-xyz",
      {
        name: "Creator",
        address: "456 St",
        city: "Manchester",
        postcode: "M1 1AA",
        country: "UK",
        phone: "07700900001",
      }
    );

    expect(customResolver).toHaveBeenCalledWith("product-xyz");
  });

  it("throws if no shipping address provided", async () => {
    const trigger = createFulfillmentTrigger();

    await expect(
      // Deliberately passing undefined to test runtime guard
      trigger("sample-req-003", "creator-202", "VIT-D-001", undefined as never)
    ).rejects.toThrow("No shipping address provided");
  });
});
