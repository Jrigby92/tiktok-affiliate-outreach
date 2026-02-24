/**
 * Trend Ingestion & Apify Integration Tests
 *
 * Verifies:
 * - All four streams parsed and stored
 * - Super viral detection
 * - Trend normalization
 * - Data structure integrity
 */

import { ApifyTrendClient } from "@/lib/trends/apify-client";
import { TrendIngestionPipeline } from "@/lib/trends/ingestion";
import { SuperViralDetector } from "@/lib/trends/alerts";
import {
  TrendingHashtag,
  TrendingSound,
  ViralVideo,
  CreatorStat,
  StoredTrend,
  DEFAULT_SUPER_VIRAL_THRESHOLDS,
} from "@/lib/trends/types";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock database pool
const mockQuery = jest.fn();
const mockDb = {
  query: mockQuery,
  connect: jest.fn().mockResolvedValue({
    query: jest.fn(),
    release: jest.fn(),
  }),
} as unknown as import("pg").Pool;

describe("ApifyTrendClient", () => {
  let client: ApifyTrendClient;

  beforeEach(() => {
    client = new ApifyTrendClient({
      apiToken: "test-apify-token",
      region: "GB",
    });
    mockFetch.mockReset();
  });

  describe("Actor configuration", () => {
    it("should create correct config for hashtags stream", () => {
      const config = client.getActorConfig("hashtags", 25);
      expect(config.actorId).toBe("clockworks/tiktok-hashtag-scraper");
      expect(config.useResidentialProxy).toBe(true);
      expect(config.input).toEqual(
        expect.objectContaining({
          region: "GB",
          maxItems: 25,
        })
      );
    });

    it("should create correct config for music_sounds stream", () => {
      const config = client.getActorConfig("music_sounds", 30);
      expect(config.actorId).toBe("clockworks/tiktok-sound-scraper");
      expect(config.useResidentialProxy).toBe(true);
      expect(config.input).toEqual(
        expect.objectContaining({
          includeBusinessInfo: true,
        })
      );
    });

    it("should create correct config for viral_videos stream", () => {
      const config = client.getActorConfig("viral_videos");
      expect(config.actorId).toBe("clockworks/tiktok-scraper");
      expect(config.useResidentialProxy).toBe(true);
      expect(config.input).toEqual(
        expect.objectContaining({
          includeTranscript: true,
        })
      );
    });

    it("should create correct config for creator_stats stream", () => {
      const config = client.getActorConfig("creator_stats");
      expect(config.actorId).toBe("clockworks/tiktok-profile-scraper");
      expect(config.useResidentialProxy).toBe(true);
      expect(config.input).toEqual(
        expect.objectContaining({
          categories: ["health", "wellness", "fitness", "supplements"],
        })
      );
    });

    it("should always enable residential proxies for stealth mode", () => {
      const streams = [
        "hashtags",
        "music_sounds",
        "viral_videos",
        "creator_stats",
      ] as const;

      for (const stream of streams) {
        const config = client.getActorConfig(stream);
        expect(config.useResidentialProxy).toBe(true);
      }
    });
  });

  describe("Bio keyword extraction", () => {
    it("should extract meaningful keywords from bio text", () => {
      // Access private method via any for testing
      const keywords = (client as unknown as { extractBioKeywords: (bio: string) => string[] })
        .extractBioKeywords(
          "Health and wellness coach | Supplements lover | London based fitness enthusiast"
        );

      expect(keywords).toContain("health");
      expect(keywords).toContain("wellness");
      expect(keywords).toContain("coach");
      expect(keywords).toContain("supplements");
      expect(keywords).toContain("fitness");
      // Should exclude stop words
      expect(keywords).not.toContain("and");
      expect(keywords).not.toContain("the");
    });

    it("should return empty array for empty bio", () => {
      const keywords = (client as unknown as { extractBioKeywords: (bio: string) => string[] })
        .extractBioKeywords("");
      expect(keywords).toEqual([]);
    });
  });
});

describe("TrendIngestionPipeline", () => {
  let pipeline: TrendIngestionPipeline;
  let mockApifyClient: jest.Mocked<ApifyTrendClient>;

  const sampleHashtags: TrendingHashtag[] = [
    {
      hashtag: "morningroutine",
      rank: 1,
      region: "GB",
      industryTag: "wellness",
      viewCount: 100_000_000,
      scrapedAt: new Date(),
    },
    {
      hashtag: "supplements",
      rank: 5,
      region: "GB",
      industryTag: "health",
      viewCount: 20_000_000,
      scrapedAt: new Date(),
    },
  ];

  const sampleSounds: TrendingSound[] = [
    {
      soundId: "sound-1",
      title: "Chill Vibes",
      artist: "DJ Wellness",
      isBusinessApproved: true,
      growthRate: 45.5,
      usageCount: 750_000,
      scrapedAt: new Date(),
    },
  ];

  const sampleVideos: ViralVideo[] = [
    {
      videoId: "video-1",
      url: "https://tiktok.com/@creator/video/1",
      creatorHandle: "healthguru",
      likes: 2_000_000,
      shares: 150_000,
      comments: 50_000,
      transcriptSummary: "My morning supplement routine with vitamin D",
      hashtags: ["morningroutine", "vitamind", "health"],
      soundId: "sound-1",
      scrapedAt: new Date(),
    },
  ];

  const sampleCreatorStats: CreatorStat[] = [
    {
      handle: "fitnessjane",
      followerCount: 600_000,
      avgEngagement: 0.08,
      bioKeywords: ["fitness", "supplements", "wellness"],
      scrapedAt: new Date(),
    },
  ];

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

    mockApifyClient = {
      scrapeHashtags: jest.fn().mockResolvedValue(sampleHashtags),
      scrapeSounds: jest.fn().mockResolvedValue(sampleSounds),
      scrapeViralVideos: jest.fn().mockResolvedValue(sampleVideos),
      scrapeCreatorStats: jest.fn().mockResolvedValue(sampleCreatorStats),
      scrapeAll: jest.fn(),
      getActorConfig: jest.fn(),
    } as unknown as jest.Mocked<ApifyTrendClient>;

    pipeline = new TrendIngestionPipeline(
      mockDb,
      mockApifyClient,
      {
        streams: ["hashtags", "music_sounds", "viral_videos", "creator_stats"],
        region: "GB",
        maxItemsPerStream: 50,
      }
    );
  });

  describe("Stream ingestion", () => {
    it("should ingest hashtags stream", async () => {
      const result = await pipeline.ingestStream("hashtags");
      expect(result.stream).toBe("hashtags");
      expect(result.itemsIngested).toBe(2);
      expect(mockApifyClient.scrapeHashtags).toHaveBeenCalledWith(50);
    });

    it("should ingest music_sounds stream", async () => {
      const result = await pipeline.ingestStream("music_sounds");
      expect(result.stream).toBe("music_sounds");
      expect(result.itemsIngested).toBe(1);
      expect(mockApifyClient.scrapeSounds).toHaveBeenCalledWith(50);
    });

    it("should ingest viral_videos stream", async () => {
      const result = await pipeline.ingestStream("viral_videos");
      expect(result.stream).toBe("viral_videos");
      expect(result.itemsIngested).toBe(1);
      expect(mockApifyClient.scrapeViralVideos).toHaveBeenCalledWith(50);
    });

    it("should ingest creator_stats stream", async () => {
      const result = await pipeline.ingestStream("creator_stats");
      expect(result.stream).toBe("creator_stats");
      expect(result.itemsIngested).toBe(1);
      expect(mockApifyClient.scrapeCreatorStats).toHaveBeenCalledWith(50);
    });

    it("should ingest all four streams", async () => {
      const results = await pipeline.ingestAll();
      expect(results).toHaveLength(4);
      expect(results.map((r) => r.stream)).toEqual([
        "hashtags",
        "music_sounds",
        "viral_videos",
        "creator_stats",
      ]);
    });

    it("should store each trend in the database", async () => {
      await pipeline.ingestStream("hashtags");

      // ensureTable + 2 inserts (2 hashtags)
      const insertCalls = mockQuery.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO trends")
      );
      expect(insertCalls).toHaveLength(2);
    });
  });

  describe("Super viral detection during ingestion", () => {
    it("should flag hashtags exceeding view count threshold", async () => {
      const result = await pipeline.ingestStream("hashtags");
      // morningroutine has 100M views > 50M threshold = super viral
      expect(result.superViralCount).toBe(1);
    });

    it("should flag videos exceeding likes threshold", async () => {
      const result = await pipeline.ingestStream("viral_videos");
      // video-1 has 2M likes > 1M threshold = super viral
      expect(result.superViralCount).toBe(1);
    });

    it("should flag sounds exceeding usage threshold", async () => {
      const result = await pipeline.ingestStream("music_sounds");
      // sound-1 has 750K usage > 500K threshold = super viral
      expect(result.superViralCount).toBe(1);
    });

    it("should flag creators exceeding follower threshold", async () => {
      const result = await pipeline.ingestStream("creator_stats");
      // fitnessjane has 600K followers > 500K threshold = super viral
      expect(result.superViralCount).toBe(1);
    });
  });

  describe("Engagement score normalization", () => {
    it("should normalize hashtag engagement to 0–100", async () => {
      // Insert call captures the stored data
      await pipeline.ingestStream("hashtags");
      const insertCalls = mockQuery.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("INSERT INTO trends")
      );

      for (const call of insertCalls) {
        const engagementScore = call[1][2]; // 3rd param
        expect(engagementScore).toBeGreaterThanOrEqual(0);
        expect(engagementScore).toBeLessThanOrEqual(100);
      }
    });
  });
});

describe("SuperViralDetector", () => {
  let detector: SuperViralDetector;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });

    detector = new SuperViralDetector({
      slackWebhookUrl: "https://hooks.slack.com/test",
      emailRecipients: ["owner@andinn.co.uk"],
      emailFrom: "alerts@andinn.co.uk",
      thresholds: DEFAULT_SUPER_VIRAL_THRESHOLDS,
    });
  });

  describe("Alert building", () => {
    it("should build alert for super viral hashtag", () => {
      const trend: StoredTrend = {
        id: 1,
        streamType: "hashtags",
        data: {
          hashtag: "morningroutine",
          rank: 1,
          region: "GB",
          industryTag: "wellness",
          viewCount: 100_000_000,
          scrapedAt: new Date(),
        },
        engagementScore: 100,
        isSuperViral: true,
        createdAt: new Date(),
      };

      const alert = detector.buildAlert(trend);
      expect(alert.reason).toContain("morningroutine");
      expect(alert.reason).toContain("100,000,000");
      expect(alert.engagementStats.viewCount).toBe(100_000_000);
      expect(alert.alertedAt).toBeDefined();
    });

    it("should build alert for super viral video", () => {
      const trend: StoredTrend = {
        id: 2,
        streamType: "viral_videos",
        data: {
          videoId: "v1",
          url: "https://tiktok.com/v1",
          creatorHandle: "healthguru",
          likes: 2_000_000,
          shares: 150_000,
          comments: 50_000,
          transcriptSummary: "supplement routine",
          hashtags: ["health"],
          scrapedAt: new Date(),
        },
        engagementScore: 90,
        isSuperViral: true,
        createdAt: new Date(),
      };

      const alert = detector.buildAlert(trend);
      expect(alert.engagementStats.likes).toBe(2_000_000);
      expect(alert.engagementStats.shares).toBe(150_000);
    });

    it("should suggest product alignment based on keywords", () => {
      const trend: StoredTrend = {
        id: 3,
        streamType: "hashtags",
        data: {
          hashtag: "vitamind",
          rank: 1,
          region: "GB",
          industryTag: "health",
          viewCount: 60_000_000,
          scrapedAt: new Date(),
        },
        engagementScore: 60,
        isSuperViral: true,
        createdAt: new Date(),
      };

      const alert = detector.buildAlert(trend);
      expect(alert.suggestedProduct).toBe("Vitamin D Supplement");
    });
  });

  describe("Alert firing", () => {
    it("should fire alerts above threshold, silent below", async () => {
      const superViralTrend: StoredTrend = {
        id: 1,
        streamType: "hashtags",
        data: {
          hashtag: "viral",
          rank: 1,
          region: "GB",
          industryTag: "wellness",
          viewCount: 100_000_000,
          scrapedAt: new Date(),
        },
        engagementScore: 100,
        isSuperViral: true,
        createdAt: new Date(),
      };

      const normalTrend: StoredTrend = {
        id: 2,
        streamType: "hashtags",
        data: {
          hashtag: "normal",
          rank: 50,
          region: "GB",
          industryTag: "general",
          viewCount: 1_000,
          scrapedAt: new Date(),
        },
        engagementScore: 5,
        isSuperViral: false,
        createdAt: new Date(),
      };

      const alerts = await detector.detectAndAlert([
        superViralTrend,
        normalTrend,
      ]);

      // Only the super viral trend triggers an alert
      expect(alerts).toHaveLength(1);
      expect(alerts[0].trend.id).toBe(1);
    });

    it("should send both Slack and email alerts", async () => {
      const trend: StoredTrend = {
        id: 1,
        streamType: "viral_videos",
        data: {
          videoId: "v1",
          url: "https://tiktok.com/v1",
          creatorHandle: "creator1",
          likes: 5_000_000,
          shares: 500_000,
          comments: 100_000,
          transcriptSummary: "trending video",
          hashtags: [],
          scrapedAt: new Date(),
        },
        engagementScore: 100,
        isSuperViral: true,
        createdAt: new Date(),
      };

      await detector.detectAndAlert([trend]);

      // Should have called fetch for Slack + email
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Slack call
      const slackCall = mockFetch.mock.calls.find(
        (call) => call[0] === "https://hooks.slack.com/test"
      );
      expect(slackCall).toBeDefined();

      // Email call
      const emailCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" && call[0].includes("email")
      );
      expect(emailCall).toBeDefined();
    });

    it("should not fire alerts when no trends are super viral", async () => {
      const normalTrend: StoredTrend = {
        id: 1,
        streamType: "hashtags",
        data: {
          hashtag: "normal",
          rank: 50,
          region: "GB",
          industryTag: "general",
          viewCount: 1_000,
          scrapedAt: new Date(),
        },
        engagementScore: 5,
        isSuperViral: false,
        createdAt: new Date(),
      };

      const alerts = await detector.detectAndAlert([normalTrend]);
      expect(alerts).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Configuration", () => {
    it("should allow config updates", () => {
      detector.updateConfig({
        slackWebhookUrl: "https://new-webhook.com",
        thresholds: { ...DEFAULT_SUPER_VIRAL_THRESHOLDS, videoLikes: 5_000_000 },
      });

      const config = detector.getConfig();
      expect(config.slackWebhookUrl).toBe("https://new-webhook.com");
      expect(config.thresholds.videoLikes).toBe(5_000_000);
    });
  });
});
