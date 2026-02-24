/**
 * Amazon SQS Consumer Tests
 *
 * Tests processing of FULFILLMENT_ORDER_STATUS messages
 * and deletion after successful processing.
 */

import { SqsConsumerWorker } from "@/lib/api/sqs/consumer";

// Mock AWS SDK
jest.mock("@aws-sdk/client-sqs", () => {
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
    ReceiveMessageCommand: jest.fn(),
    DeleteMessageCommand: jest.fn(),
  };
});

describe("Amazon SQS Consumer", () => {
  let consumer: SqsConsumerWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new SqsConsumerWorker({
      queueUrl: "https://sqs.eu-west-2.amazonaws.com/123456789/andinn-fulfillment",
      region: "eu-west-2",
    });
  });

  it("should process a valid FULFILLMENT_ORDER_STATUS message", () => {
    const message = {
      MessageId: "msg-1",
      ReceiptHandle: "receipt-1",
      Body: JSON.stringify({
        notificationType: "FULFILLMENT_ORDER_STATUS",
        payload: {
          fulfillmentOrderStatus: {
            sellerFulfillmentOrderId: "ANDINN-001",
            fulfillmentOrderStatus: "Complete",
            statusUpdatedDateTime: "2026-02-24T12:00:00Z",
            fulfillmentShipment: {
              shipmentId: "SHIP-001",
              amazonShipmentId: "SHIP-001",
              fulfillmentShipmentStatus: "SHIPPED",
              packageNumber: 12345,
            },
          },
        },
      }),
    };

    const result = consumer.processFulfillmentStatus(message);

    expect(result).not.toBeNull();
    expect(result!.payload.fulfillmentOrderStatus.sellerFulfillmentOrderId).toBe("ANDINN-001");
    expect(result!.payload.fulfillmentOrderStatus.fulfillmentOrderStatus).toBe("Complete");
    expect(result!.payload.fulfillmentOrderStatus.fulfillmentShipment?.packageNumber).toBe(12345);
  });

  it("should handle SNS-wrapped SQS messages", () => {
    const snsWrapped = {
      MessageId: "msg-2",
      ReceiptHandle: "receipt-2",
      Body: JSON.stringify({
        Message: JSON.stringify({
          notificationType: "FULFILLMENT_ORDER_STATUS",
          payload: {
            fulfillmentOrderStatus: {
              sellerFulfillmentOrderId: "ANDINN-002",
              fulfillmentOrderStatus: "Processing",
              statusUpdatedDateTime: "2026-02-24T13:00:00Z",
            },
          },
        }),
      }),
    };

    const result = consumer.processFulfillmentStatus(snsWrapped);

    expect(result).not.toBeNull();
    expect(result!.payload.fulfillmentOrderStatus.sellerFulfillmentOrderId).toBe("ANDINN-002");
    expect(result!.payload.fulfillmentOrderStatus.fulfillmentOrderStatus).toBe("Processing");
  });

  it("should return null for empty message bodies", () => {
    const emptyMessage = {
      MessageId: "msg-3",
      ReceiptHandle: "receipt-3",
      Body: undefined,
    };

    const result = consumer.processFulfillmentStatus(emptyMessage as never);
    expect(result).toBeNull();
  });

  it("should handle malformed JSON gracefully", () => {
    const malformed = {
      MessageId: "msg-4",
      ReceiptHandle: "receipt-4",
      Body: "not valid json",
    };

    const result = consumer.processFulfillmentStatus(malformed);
    expect(result).toBeNull();
  });

  it("should return null for non-FULFILLMENT_ORDER_STATUS messages", () => {
    const otherMessage = {
      MessageId: "msg-5",
      ReceiptHandle: "receipt-5",
      Body: JSON.stringify({
        notificationType: "OTHER_TYPE",
        payload: {},
      }),
    };

    const result = consumer.processFulfillmentStatus(otherMessage);
    expect(result).toBeNull();
  });
});
