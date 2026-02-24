/**
 * Creator Discovery Service Tests
 *
 * Tests:
 * - UK filters applied correctly
 * - Results stored in creators table
 * - Pagination handling
 */

import { CreatorDiscoveryService } from "@/lib/creators/discovery";
import { TikTokApiClient } from "@/lib/api/tiktok/client";
import { CreatorProfile } from "@/lib/api/tiktok";

// Mock TikTok API
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
  connect: jest.fn(),
} as unknown as import("pg").Pool;

function makeApiCreator(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    creator_id: "c1",
    handle: "@healthcreator",
    display_name: "Health Creator",
    follower_count: 50000,
    violation_count: 1,
    engagement_metrics: {
      likes: 5000,
      shares: 500,
      comments: 200,
      conversion_rate: 0.03,
      avg_video_views: 25000,
      engagement_rate: 0.05,
    },
    niche_tags: ["supplements", "fitness", "wellness"],
    demographics: {
      top_countries: [{ country: "GB", percentage: 0.8 }],
      age_distribution: [{ range: "25-34", percentage: 0.4 }],
      gender_distribution: [{ gender: "female", percentage: 0.6 }],
    },
    gmv: 15000,
    posting_frequency: "daily",
    sample_reliability: "high",
    bio: "Wellness advocate",
    ...overrides,
  };
}

describe("CreatorDiscoveryService", () => {
  let service: CreatorDiscoveryService;
  let client: TikTokApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new TikTokApiClient("test-token");
    service = new CreatorDiscoveryService(client, mockPool);
  });

  describe("runDiscovery", () => {
    it("should apply default UK market filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            creators: [makeApiCreator()],
            cursor: undefined,
            total_count: 1,
          },
        }),
      });

      mockQuery
        // upsert
        .mockResolvedValueOnce({ rows: [{ is_new: true }] })
        // count
        .mockResolvedValueOnce({ rows: [{ count: "1" }] });

      const result = await service.runDiscovery();

      // Verify UK filters applied
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.min_followers).toBe(5000);
      expect(body.max_violations).toBe(3);
      expect(body.demographics.country).toBe("GB");

      expect(result.creators).toHaveLength(1);
      expect(result.newCreators).toBe(1);
    });

    it("should allow custom filter overrides", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { creators: [], cursor: undefined, total_count: 0 },
        }),
      });

      mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });

      await service.runDiscovery({
        filters: {
          minFollowers: 10000,
          productCategory: "supplements",
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.min_followers).toBe(10000);
      expect(body.product_category).toBe("supplements");
    });

    it("should paginate through results up to maxResults", async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            creators: [
              makeApiCreator({ creator_id: "c1", handle: "@c1" }),
              makeApiCreator({ creator_id: "c2", handle: "@c2" }),
            ],
            cursor: "page2",
            total_count: 3,
          },
        }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            creators: [makeApiCreator({ creator_id: "c3", handle: "@c3" })],
            cursor: undefined,
            total_count: 3,
          },
        }),
      });

      // Upserts
      mockQuery
        .mockResolvedValueOnce({ rows: [{ is_new: true }] })
        .mockResolvedValueOnce({ rows: [{ is_new: true }] })
        .mockResolvedValueOnce({ rows: [{ is_new: true }] })
        // Count
        .mockResolvedValueOnce({ rows: [{ count: "3" }] });

      const result = await service.runDiscovery({ maxResults: 3 });

      expect(result.creators).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should count new vs updated creators", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            creators: [
              makeApiCreator({ handle: "@new" }),
              makeApiCreator({ handle: "@existing" }),
            ],
            cursor: undefined,
            total_count: 2,
          },
        }),
      });

      mockQuery
        .mockResolvedValueOnce({ rows: [{ is_new: true }] }) // @new
        .mockResolvedValueOnce({ rows: [{ is_new: false }] }) // @existing (update)
        .mockResolvedValueOnce({ rows: [{ count: "5" }] }); // total

      const result = await service.runDiscovery();

      expect(result.newCreators).toBe(1);
      expect(result.updatedCreators).toBe(1);
      expect(result.totalInDb).toBe(5);
    });

    it("should skip persistence when persistResults=false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            creators: [makeApiCreator()],
            cursor: undefined,
            total_count: 1,
          },
        }),
      });

      // Only the count query should run
      mockQuery.mockResolvedValueOnce({ rows: [{ count: "10" }] });

      const result = await service.runDiscovery({ persistResults: false });

      expect(result.creators).toHaveLength(1);
      expect(result.newCreators).toBe(0);
      expect(result.updatedCreators).toBe(0);
    });
  });

  describe("getStoredCreators", () => {
    it("should filter by niche tags", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            handle: "@fit",
            follower_count: 20000,
            engagement_metrics: {
              likes: 1000,
              shares: 100,
              comments: 50,
              conversionRate: 0.02,
              avgVideoViews: 15000,
              engagementRate: 0.04,
            },
            niche_tags: ["fitness", "supplements"],
          },
        ],
      });

      const creators = await service.getStoredCreators(["supplements"]);

      expect(creators).toHaveLength(1);
      expect(creators[0].handle).toBe("@fit");
      expect(mockQuery.mock.calls[0][0]).toContain("niche_tags && $1");
    });

    it("should filter by minimum engagement rate", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.getStoredCreators(undefined, 0.05);

      expect(mockQuery.mock.calls[0][0]).toContain("engagementRate");
    });
  });
});
