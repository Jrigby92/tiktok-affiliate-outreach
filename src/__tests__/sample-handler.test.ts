/**
 * Sample Request Handler Tests
 *
 * Tests:
 * - 72-hour deadline monitoring and escalation
 * - Approve → triggers MCF fulfillment (stubbed)
 * - Reject → notifies creator through delay layer
 * - Overdue request rejection
 */

import { SampleRequestHandler } from "@/lib/samples/handler";

// Mock BullMQ and Redis connection
jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("@/lib/queue/connection", () => ({
  redisConnection: { host: "localhost", port: 6379 },
  getRedisConnection: jest.fn().mockReturnValue({ host: "localhost", port: 6379 }),
}));

// Create mock TikTok client with all methods the source calls
function createMockTikTokClient() {
  return {
    getSampleRequest: jest.fn(),
    listAllSampleRequests: jest.fn(),
    decideSample: jest.fn(),
    searchCreators: jest.fn(),
    enrollOpenCollaboration: jest.fn(),
    createTargetCampaign: jest.fn(),
    manageSample: jest.fn(),
    sendIM: jest.fn(),
    getDailyInvitationCount: jest.fn().mockReturnValue(0),
    getRemainingDailyInvitations: jest.fn().mockReturnValue(1000),
  };
}

// Create mock message sender with all methods the source calls
function createMockMessageSender() {
  return {
    send: jest.fn().mockResolvedValue({
      messageId: "msg_test",
      type: "approval",
      recipientId: "c1",
      content: "test",
      actualDelayMs: 0,
      scheduledAt: new Date(),
      deliverAt: new Date(),
    }),
    sendSampleNotification: jest.fn().mockResolvedValue(undefined),
    sendCollaborationInvitation: jest.fn().mockResolvedValue(undefined),
    sendTrackingNotification: jest.fn().mockResolvedValue(undefined),
  };
}

const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as import("pg").Pool;

describe("SampleRequestHandler", () => {
  let handler: SampleRequestHandler;
  let mockTikTokClient: ReturnType<typeof createMockTikTokClient>;
  let mockMessageSender: ReturnType<typeof createMockMessageSender>;
  let fulfillmentTrigger: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTikTokClient = createMockTikTokClient();
    mockMessageSender = createMockMessageSender();
    fulfillmentTrigger = jest.fn().mockResolvedValue({
      fulfillmentId: "ful-stub-123",
    });
    handler = new SampleRequestHandler(
      mockTikTokClient as never,
      mockMessageSender as never,
      mockPool,
      fulfillmentTrigger
    );
  });

  describe("processSampleDecision — approve", () => {
    it("should approve and trigger fulfillment", async () => {
      const futureDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);

      // getSampleRequest returns the request details
      mockTikTokClient.getSampleRequest.mockResolvedValueOnce({
        requestId: "sr-1",
        creatorId: "c1",
        creatorHandle: "@creator1",
        productId: "prod-1",
        sampleType: "free_manual",
        status: "pending",
        requestedAt: new Date().toISOString(),
        deadlineAt: futureDeadline.toISOString(),
        shippingAddress: {
          name: "Jane Doe",
          address: "123 High Street",
          city: "London",
          postcode: "SW1A 1AA",
          country: "GB",
          phone: "+44123456789",
        },
      });

      // decideSample API call
      mockTikTokClient.decideSample.mockResolvedValueOnce({});

      // orders insert
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // sendSampleNotification
      mockMessageSender.sendSampleNotification.mockResolvedValueOnce(
        undefined
      );

      // sample_decisions insert
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await handler.processSampleDecision({
        requestId: "sr-1",
        decision: "approve",
      });

      expect(result.decision).toBe("approved");
      expect(result.fulfillmentTriggered).toBe(true);
      expect(result.notificationSent).toBe(true);
      expect(fulfillmentTrigger).toHaveBeenCalledWith(
        "sr-1",
        "c1",
        "prod-1",
        expect.objectContaining({ name: "Jane Doe", postcode: "SW1A 1AA" })
      );
    });
  });

  describe("processSampleDecision — reject", () => {
    it("should reject and notify creator", async () => {
      const futureDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);

      // getSampleRequest
      mockTikTokClient.getSampleRequest.mockResolvedValueOnce({
        requestId: "sr-2",
        creatorId: "c2",
        creatorHandle: "@creator2",
        productId: "prod-1",
        sampleType: "free_manual",
        status: "pending",
        requestedAt: new Date().toISOString(),
        deadlineAt: futureDeadline.toISOString(),
      });

      // decideSample
      mockTikTokClient.decideSample.mockResolvedValueOnce({});

      // sendSampleNotification
      mockMessageSender.sendSampleNotification.mockResolvedValueOnce(
        undefined
      );

      // sample_decisions insert
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await handler.processSampleDecision({
        requestId: "sr-2",
        decision: "reject",
        reason: "Engagement too low",
      });

      expect(result.decision).toBe("rejected");
      expect(result.fulfillmentTriggered).toBe(false);
      expect(result.notificationSent).toBe(true);
      expect(fulfillmentTrigger).not.toHaveBeenCalled();
    });
  });

  describe("72-hour deadline enforcement", () => {
    it("should reject if past deadline", async () => {
      const pastDeadline = new Date(Date.now() - 1000); // 1 second ago

      mockTikTokClient.getSampleRequest.mockResolvedValueOnce({
        requestId: "sr-expired",
        creatorId: "c3",
        creatorHandle: "@creator3",
        productId: "prod-1",
        sampleType: "free_manual",
        status: "pending",
        requestedAt: new Date(
          Date.now() - 73 * 60 * 60 * 1000
        ).toISOString(),
        deadlineAt: pastDeadline.toISOString(),
      });

      await expect(
        handler.processSampleDecision({
          requestId: "sr-expired",
          decision: "approve",
        })
      ).rejects.toThrow("exceeded the 72-hour deadline");
    });
  });

  describe("checkDeadlines", () => {
    it("should escalate requests within 12 hours of deadline", async () => {
      const soon = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours away
      const notSoon = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours away

      mockTikTokClient.listAllSampleRequests.mockResolvedValueOnce([
        {
          requestId: "sr-urgent",
          creatorId: "c1",
          creatorHandle: "@urgent",
          productId: "prod-1",
          sampleType: "free_manual",
          status: "pending",
          requestedAt: new Date().toISOString(),
          deadlineAt: soon.toISOString(),
        },
        {
          requestId: "sr-safe",
          creatorId: "c2",
          creatorHandle: "@safe",
          productId: "prod-1",
          sampleType: "free_manual",
          status: "pending",
          requestedAt: new Date().toISOString(),
          deadlineAt: notSoon.toISOString(),
        },
      ]);

      const onEscalation = jest.fn();
      handler.onEscalation = onEscalation;

      const escalations = await handler.checkDeadlines();

      expect(escalations).toHaveLength(1);
      expect(escalations[0].requestId).toBe("sr-urgent");
      expect(escalations[0].hoursRemaining).toBeLessThan(12);
      expect(onEscalation).toHaveBeenCalledWith(escalations);
    });

    it("should not escalate requests with plenty of time", async () => {
      const plenty = new Date(Date.now() + 48 * 60 * 60 * 1000);

      mockTikTokClient.listAllSampleRequests.mockResolvedValueOnce([
        {
          requestId: "sr-ok",
          creatorId: "c1",
          creatorHandle: "@ok",
          productId: "prod-1",
          sampleType: "free_manual",
          status: "pending",
          requestedAt: new Date().toISOString(),
          deadlineAt: plenty.toISOString(),
        },
      ]);

      const escalations = await handler.checkDeadlines();
      expect(escalations).toHaveLength(0);
    });
  });
});
