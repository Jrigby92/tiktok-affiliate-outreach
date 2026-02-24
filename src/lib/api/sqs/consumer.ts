import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message as SQSMessage,
} from "@aws-sdk/client-sqs";

// ============================================================
// Amazon SQS Consumer for FULFILLMENT_ORDER_STATUS Notifications
//
// Amazon SP-API delivers fulfillment status notifications via
// SQS (NOT HTTP webhooks). This consumer polls the queue and
// processes status updates.
// ============================================================

export interface SqsConsumerConfig {
  /** Full SQS queue URL */
  queueUrl: string;
  /** AWS region (e.g. "eu-west-2") */
  region: string;
  /** Maximum number of messages per poll (1-10, default 10) */
  maxMessages?: number;
  /** Long-poll wait time in seconds (0-20, default 20) */
  waitTimeSeconds?: number;
  /** Visibility timeout in seconds (default 30) */
  visibilityTimeout?: number;
}

export interface FulfillmentStatusNotification {
  notificationType: string;
  payloadVersion: string;
  eventTime: string;
  payload: {
    fulfillmentOrderStatus: {
      sellerFulfillmentOrderId: string;
      fulfillmentOrderStatus: string;
      statusUpdatedDateTime: string;
      fulfillmentShipment?: {
        shipmentId: string;
        amazonShipmentId: string;
        fulfillmentShipmentStatus: string;
        shippingDateTime?: string;
        estimatedArrivalDateTime?: string;
        packageNumber?: number;
      };
    };
  };
}

export { SQSMessage };

export class SqsConsumerWorker {
  private client: SQSClient;
  private queueUrl: string;
  private maxMessages: number;
  private waitTimeSeconds: number;
  private visibilityTimeout: number;

  constructor(config: SqsConsumerConfig) {
    this.queueUrl = config.queueUrl;
    this.maxMessages = config.maxMessages ?? 10;
    this.waitTimeSeconds = config.waitTimeSeconds ?? 20;
    this.visibilityTimeout = config.visibilityTimeout ?? 30;

    this.client = new SQSClient({
      region: config.region,
    });
  }

  /**
   * Poll the SQS queue for messages. Uses long polling by default.
   * Returns raw SQS messages (caller should process and then delete).
   */
  async pollMessages(): Promise<SQSMessage[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: this.maxMessages,
      WaitTimeSeconds: this.waitTimeSeconds,
      VisibilityTimeout: this.visibilityTimeout,
      MessageAttributeNames: ["All"],
      AttributeNames: ["All"],
    });

    const response = await this.client.send(command);

    return response.Messages ?? [];
  }

  /**
   * Delete a processed message from the queue.
   * Must be called after successful processing to prevent redelivery.
   */
  async deleteMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.client.send(command);
  }

  /**
   * Parse a FULFILLMENT_ORDER_STATUS notification from an SQS message body.
   * Amazon SP-API wraps the notification in an SNS-like envelope when
   * delivered to SQS.
   *
   * Returns the parsed notification or null if the message is not a
   * valid fulfillment status notification.
   */
  processFulfillmentStatus(
    message: SQSMessage
  ): FulfillmentStatusNotification | null {
    if (!message.Body) {
      return null;
    }

    try {
      // The SQS message body may be a direct notification or wrapped
      // in an SNS envelope (when SQS is subscribed to an SNS topic).
      let parsed: Record<string, unknown> = JSON.parse(message.Body);

      // If it is an SNS envelope, the actual notification is in the
      // "Message" field as a JSON string.
      if (typeof parsed.Message === "string") {
        parsed = JSON.parse(parsed.Message as string);
      }

      // Validate this is a FULFILLMENT_ORDER_STATUS notification
      if (parsed.notificationType !== "FULFILLMENT_ORDER_STATUS") {
        return null;
      }

      const notification = parsed as unknown as FulfillmentStatusNotification;

      // Basic validation of required fields
      if (
        !notification.payload?.fulfillmentOrderStatus
          ?.sellerFulfillmentOrderId ||
        !notification.payload?.fulfillmentOrderStatus
          ?.fulfillmentOrderStatus
      ) {
        return null;
      }

      return notification;
    } catch {
      // Malformed JSON — skip this message
      return null;
    }
  }
}
