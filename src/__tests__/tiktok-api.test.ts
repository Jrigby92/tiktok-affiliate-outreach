/**
 * TikTok API Client Tests
 *
 * Tests creator search filters, sample management (72-hour window),
 * and Target Collaboration daily invitation limit.
 */

import { TikTokApiClient } from "@/lib/api/tiktok/client";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("TikTok API Client", () => {
  let client: TikTokApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new TikTokApiClient("test-access-token");
  });

  describe("Creator Search", () => {
    it("should send search request with filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            creators: [
              {
                creator_id: "c1",
                handle: "@healthguru",
                display_name: "Health Guru",
                follower_count: 50000,
                violation_count: 0,
                engagement_metrics: {
                  likes: 5000,
                  shares: 500,
                  comments: 200,
                  conversion_rate: 0.03,
                  avg_video_views: 25000,
                  engagement_rate: 0.05,
                },
                niche_tags: ["supplements", "wellness"],
                demographics: {
                  top_countries: [{ country: "GB", percentage: 0.8 }],
                  age_distribution: [],
                  gender_distribution: [],
                },
                gmv: 15000,
                posting_frequency: "daily",
                sample_reliability: "high",
                bio: "Wellness advocate",
              },
            ],
            cursor: null,
            total_count: 1,
          },
        }),
      });

      const result = await client.searchCreators({
        minFollowers: 5000,
        maxViolations: 3,
        demographics: { country: "GB" },
        minEngagementRate: 0.02,
      });

      // Verify the request body
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.min_followers).toBe(5000);
      expect(body.max_violations).toBe(3);
      expect(body.demographics.country).toBe("GB");
      expect(body.min_engagement_rate).toBe(0.02);
      expect(result.creators).toHaveLength(1);
      expect(result.creators[0].handle).toBe("@healthguru");
    });

    it("should allow overriding default filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { creators: [], cursor: null, total_count: 0 },
        }),
      });

      await client.searchCreators({
        minFollowers: 10000,
        minEngagementRate: 0.05,
        productCategory: "supplements",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.min_followers).toBe(10000);
      expect(body.min_engagement_rate).toBe(0.05);
      expect(body.product_category).toBe("supplements");
    });
  });

  describe("Target Collaboration — Daily Invitation Limit", () => {
    it("should track daily invitation count", () => {
      const count = client.getDailyInvitationCount();
      expect(count).toBe(0);

      const remaining = client.getRemainingDailyInvitations();
      expect(remaining).toBe(1000);
    });

    it("should enforce 1,000 invitations per day", async () => {
      // Create a target campaign with more creators than remaining quota
      // First use up some quota by creating a small campaign
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            campaign_id: "camp-1",
            invitations: [
              { invitation_id: "inv-1", creator_id: "c1", status: "sent" },
            ],
          },
        }),
      });

      await client.createTargetCampaign({
        creatorIds: ["c1"],
        productIds: ["prod-1"],
        commissionConfig: { type: "flat", flatRate: 15 },
        sampleType: "free_auto_approve",
        message: "Join us!",
      });

      expect(client.getDailyInvitationCount()).toBe(1);
      expect(client.getRemainingDailyInvitations()).toBe(999);
    });
  });

  describe("Sample Management", () => {
    it("should approve a sample request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {},
        }),
      });

      await client.manageSample({
        requestId: "sample-req-1",
        decision: "approve",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.request_id).toBe("sample-req-1");
      expect(body.decision).toBe("approve");
    });

    it("should reject a sample request with reason", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {},
        }),
      });

      await client.manageSample({
        requestId: "sample-req-2",
        decision: "reject",
        reason: "Creator does not meet engagement threshold",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.decision).toBe("reject");
      expect(body.reason).toContain("engagement threshold");
    });
  });

  describe("IM Messaging — with fallback", () => {
    it("should send via IM when available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            message_id: "msg-1",
          },
        }),
      });

      const result = await client.sendIM({
        recipientId: "creator-1",
        messageType: "content_brief",
        content: "Check out this brief!",
      });

      expect(result.sent).toBe(true);
      expect(result.fallbackUsed).toBe(false);
      expect(result.messageId).toBe("msg-1");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should fallback to collaboration messaging when IM fails with 404", async () => {
      // IM fails with 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          code: "im_not_available",
          message: "IM endpoint unavailable",
        }),
      });

      // Fallback succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            message_id: "msg-fallback",
          },
        }),
      });

      const result = await client.sendIM({
        recipientId: "creator-1",
        messageType: "general",
        content: "Hello!",
      });

      expect(result.sent).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
