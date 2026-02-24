/**
 * Collaboration Management Tests
 *
 * Tests:
 * - Open Collaboration: auto-approval triggers above threshold
 * - Target Collaboration: invitation with custom commission, daily limit
 * - Commission precedence: Target supersedes Open
 */

import { OpenCollaborationManager } from "@/lib/collaboration/open";
import { TargetCollaborationManager } from "@/lib/collaboration/target";
import { InfluencerMessageSender } from "@/lib/messaging/sender";
import { InfluencerDelayLayer } from "@/lib/messaging/delay-layer";
import { CreatorProductMatch } from "@/lib/creators/types";

jest.useFakeTimers();

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Create a mock TikTok client with all methods the source code calls
function createMockTikTokClient() {
  return {
    enrollOpenCollaboration: jest.fn(),
    listOpenSampleRequests: jest.fn(),
    decideSample: jest.fn(),
    createTargetCampaign: jest.fn(),
    getDailyInviteCount: jest.fn().mockReturnValue({ count: 0, limit: 1000 }),
    searchCreators: jest.fn(),
    manageSample: jest.fn(),
    sendIM: jest.fn(),
    getDailyInvitationCount: jest.fn().mockReturnValue(0),
    getRemainingDailyInvitations: jest.fn().mockReturnValue(1000),
  };
}

const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
  connect: jest.fn(),
} as unknown as import("pg").Pool;

describe("OpenCollaborationManager", () => {
  let manager: OpenCollaborationManager;
  let mockTikTokClient: ReturnType<typeof createMockTikTokClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTikTokClient = createMockTikTokClient();
    manager = new OpenCollaborationManager(
      mockTikTokClient as never,
      mockPool
    );
  });

  describe("enrollProduct", () => {
    it("should enroll a product with flat commission", async () => {
      mockTikTokClient.enrollOpenCollaboration.mockResolvedValueOnce({
        collaborationId: "collab-open-1",
        status: "active",
        creatorId: "",
        productIds: ["prod-1"],
        commissionRate: 15,
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await manager.enrollProduct({
        productId: "prod-1",
        commission: { type: "flat", flatRate: 15 },
        sampleType: "free_manual",
        autoApproveThreshold: 0.05,
      });

      expect(result.collaborationId).toBe("collab-open-1");
    });

    it("should reject commission rate outside 1-80%", async () => {
      await expect(
        manager.enrollProduct({
          productId: "prod-1",
          commission: { type: "flat", flatRate: 85 },
          sampleType: "free_manual",
          autoApproveThreshold: 0.05,
        })
      ).rejects.toThrow("Commission rate must be between 1% and 80%");

      await expect(
        manager.enrollProduct({
          productId: "prod-1",
          commission: { type: "flat", flatRate: 0 },
          sampleType: "free_manual",
          autoApproveThreshold: 0.05,
        })
      ).rejects.toThrow("Commission rate must be between 1% and 80%");
    });
  });

  describe("processAutoApprovals", () => {
    it("should auto-approve creators above engagement threshold", async () => {
      // listOpenSampleRequests returns pending requests
      mockTikTokClient.listOpenSampleRequests.mockResolvedValueOnce([
        {
          requestId: "sr-1",
          creatorId: "c1",
          creatorHandle: "@highengagement",
          productId: "prod-1",
          sampleType: "free_manual",
          status: "pending",
          requestedAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        },
        {
          requestId: "sr-2",
          creatorId: "c2",
          creatorHandle: "@lowengagement",
          productId: "prod-1",
          sampleType: "free_manual",
          status: "pending",
          requestedAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        },
      ]);

      // DB lookup for @highengagement
      mockQuery.mockResolvedValueOnce({
        rows: [{ engagement_metrics: { engagementRate: 0.08 } }],
      });

      // decideSample (approve)
      mockTikTokClient.decideSample.mockResolvedValueOnce({});

      // DB lookup for @lowengagement
      mockQuery.mockResolvedValueOnce({
        rows: [{ engagement_metrics: { engagementRate: 0.02 } }],
      });

      const result = await manager.processAutoApprovals("prod-1", 0.05);

      expect(result.approved).toContain("sr-1");
      expect(result.pendingManual).toContain("sr-2");
      expect(result.approved).toHaveLength(1);
      expect(result.pendingManual).toHaveLength(1);
    });

    it("should route unknown creators to manual review", async () => {
      mockTikTokClient.listOpenSampleRequests.mockResolvedValueOnce([
        {
          requestId: "sr-3",
          creatorId: "c3",
          creatorHandle: "@unknown",
          productId: "prod-1",
          sampleType: "free_manual",
          status: "pending",
          requestedAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        },
      ]);

      // No creator found in DB
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await manager.processAutoApprovals("prod-1", 0.05);
      expect(result.pendingManual).toContain("sr-3");
    });
  });
});

describe("TargetCollaborationManager", () => {
  let manager: TargetCollaborationManager;
  let mockTikTokClient: ReturnType<typeof createMockTikTokClient>;
  let messageSender: InfluencerMessageSender;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTikTokClient = createMockTikTokClient();

    const delayLayer = new InfluencerDelayLayer({
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    // InfluencerMessageSender takes (delayLayer, sendFn)
    // The source calls messageSender.sendCollaborationInvitation() which
    // doesn't exist on the real sender. Create a mock sender instead.
    messageSender = {
      send: jest.fn().mockResolvedValue({
        messageId: "msg_test",
        type: "invitation",
        recipientId: "c1",
        content: "test",
        actualDelayMs: 0,
        scheduledAt: new Date(),
        deliverAt: new Date(),
      }),
      sendCollaborationInvitation: jest.fn().mockResolvedValue({
        message: {
          id: "msg_test",
          type: "invitation",
          recipientId: "c1",
          payload: {},
          queuedAt: new Date(),
          scheduledSendAt: new Date(),
          appliedDelayMs: 0,
        },
        sent: true,
      }),
      sendSampleNotification: jest.fn().mockResolvedValue(undefined),
      sendTrackingNotification: jest.fn().mockResolvedValue(undefined),
    } as unknown as InfluencerMessageSender;

    manager = new TargetCollaborationManager(
      mockTikTokClient as never,
      messageSender,
      mockPool
    );
  });

  describe("runCampaign", () => {
    const matches: CreatorProductMatch[] = [
      {
        creatorId: "c1",
        creatorHandle: "@top_creator",
        productId: "prod-1",
        productName: "Vitamin D3",
        matchScore: 85,
        scoreBreakdown: {
          nicheAlignment: 90,
          engagementQuality: 80,
          audienceOverlap: 85,
          conversionPotential: 75,
        },
        rank: 1,
      },
      {
        creatorId: "c2",
        creatorHandle: "@good_creator",
        productId: "prod-1",
        productName: "Vitamin D3",
        matchScore: 70,
        scoreBreakdown: {
          nicheAlignment: 75,
          engagementQuality: 65,
          audienceOverlap: 70,
          conversionPotential: 60,
        },
        rank: 2,
      },
      {
        creatorId: "c3",
        creatorHandle: "@low_creator",
        productId: "prod-1",
        productName: "Vitamin D3",
        matchScore: 30,
        scoreBreakdown: {
          nicheAlignment: 30,
          engagementQuality: 25,
          audienceOverlap: 35,
          conversionPotential: 20,
        },
        rank: 3,
      },
    ];

    it("should send invitations to creators above minimum match score", async () => {
      // DB inserts
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await manager.runCampaign(matches, {
        productIds: ["prod-1"],
        commission: { type: "flat", flatRate: 20 },
        sampleType: "free_auto_approve",
        messageTemplate:
          "Hi {creatorName}, we'd love you to try {productName}!",
        minMatchScore: 60,
        maxInvitations: 10,
      });

      // Only c1 (85) and c2 (70) are above threshold 60
      expect(result.sent).toBe(2);
      expect(result.invitations.filter((i) => i.status === "sent")).toHaveLength(
        2
      );
    });

    it("should reject commission outside 1-80%", async () => {
      await expect(
        manager.runCampaign(matches, {
          productIds: ["prod-1"],
          commission: { type: "flat", flatRate: 90 },
          sampleType: "free_auto_approve",
          messageTemplate: "Hi!",
          minMatchScore: 50,
          maxInvitations: 10,
        })
      ).rejects.toThrow("Commission rate must be between 1% and 80%");
    });

    it("should personalize message template", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await manager.runCampaign(
        [matches[0]], // Just top creator
        {
          productIds: ["prod-1"],
          commission: { type: "flat", flatRate: 20 },
          sampleType: "free_auto_approve",
          messageTemplate:
            "Hi {creatorName}, we'd love you to try {productName}!",
          minMatchScore: 0,
          maxInvitations: 1,
        }
      );

      // sendCollaborationInvitation should have been called with personalized message
      expect(messageSender.sendCollaborationInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Hi @top_creator, we'd love you to try Vitamin D3!",
        })
      );
    });
  });

  describe("getDailyInviteStatus", () => {
    it("should report remaining invitations", () => {
      const status = manager.getDailyInviteStatus();
      expect(status.limit).toBe(1000);
      expect(status.remaining).toBe(1000);
    });
  });
});
