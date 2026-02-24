/**
 * Match-Making Engine Tests
 *
 * Tests:
 * - Sensible rankings for known creator-product pairs
 * - Score breakdown correctness
 * - Weight tuning
 */

import { MatchMakingEngine } from "@/lib/creators/match-making";
import { CreatorProfile } from "@/lib/api/tiktok";
import { ProductCatalogEntry } from "@/lib/creators/types";

const mockPool = {
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  }),
} as unknown as import("pg").Pool;

function makeCreator(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
  return {
    creatorId: "c1",
    handle: "@healthguru",
    displayName: "Health Guru",
    followerCount: 50000,
    violationCount: 0,
    engagementMetrics: {
      likes: 5000,
      shares: 500,
      comments: 200,
      conversionRate: 0.03,
      avgVideoViews: 25000,
      engagementRate: 0.05,
    },
    nicheTags: ["supplements", "fitness", "wellness"],
    demographics: {
      topCountries: [{ country: "GB", percentage: 0.8 }],
      ageDistribution: [{ range: "25-34", percentage: 0.4 }],
      genderDistribution: [{ gender: "female", percentage: 0.6 }],
    },
    gmv: 15000,
    postingFrequency: "daily",
    sampleReliability: "high",
    bio: "Wellness advocate",
    ...overrides,
  };
}

const testProduct: ProductCatalogEntry = {
  productId: "prod-vitamin-d",
  sku: "AND-VD-001",
  name: "Vitamin D3 4000IU",
  category: "supplements",
  targetAudience: {
    countries: ["GB"],
    interests: ["supplements", "health", "wellness"],
    ageRange: ["25-34", "35-44"],
    gender: ["female", "male"],
  },
  nicheTags: ["supplements", "wellness", "immune-support"],
  price: 14.99,
};

describe("MatchMakingEngine", () => {
  let engine: MatchMakingEngine;

  beforeEach(() => {
    engine = new MatchMakingEngine(mockPool);
  });

  describe("scoreCreatorProduct", () => {
    it("should produce a score between 0 and 100", () => {
      const creator = makeCreator();
      const result = engine.scoreCreatorProduct(creator, testProduct);

      expect(result.matchScore).toBeGreaterThan(0);
      expect(result.matchScore).toBeLessThanOrEqual(100);
    });

    it("should rank a wellness creator higher than a gaming creator for supplements", () => {
      const wellnessCreator = makeCreator({
        creatorId: "wellness",
        handle: "@wellness",
        nicheTags: ["supplements", "wellness", "fitness"],
        engagementMetrics: {
          likes: 5000,
          shares: 500,
          comments: 200,
          conversionRate: 0.03,
          avgVideoViews: 25000,
          engagementRate: 0.05,
        },
      });

      const gamingCreator = makeCreator({
        creatorId: "gaming",
        handle: "@gamer",
        nicheTags: ["gaming", "esports", "tech"],
        engagementMetrics: {
          likes: 5000,
          shares: 500,
          comments: 200,
          conversionRate: 0.03,
          avgVideoViews: 25000,
          engagementRate: 0.05,
        },
      });

      const wellnessScore = engine.scoreCreatorProduct(
        wellnessCreator,
        testProduct
      );
      const gamingScore = engine.scoreCreatorProduct(
        gamingCreator,
        testProduct
      );

      expect(wellnessScore.matchScore).toBeGreaterThan(gamingScore.matchScore);
      expect(wellnessScore.scoreBreakdown.nicheAlignment).toBeGreaterThan(
        gamingScore.scoreBreakdown.nicheAlignment
      );
    });

    it("should score higher engagement rate creators higher", () => {
      const highEngagement = makeCreator({
        creatorId: "high",
        engagementMetrics: {
          likes: 10000,
          shares: 2000,
          comments: 800,
          conversionRate: 0.05,
          avgVideoViews: 50000,
          engagementRate: 0.08,
        },
      });

      const lowEngagement = makeCreator({
        creatorId: "low",
        engagementMetrics: {
          likes: 100,
          shares: 10,
          comments: 5,
          conversionRate: 0.005,
          avgVideoViews: 2000,
          engagementRate: 0.01,
        },
      });

      const highScore = engine.scoreCreatorProduct(highEngagement, testProduct);
      const lowScore = engine.scoreCreatorProduct(lowEngagement, testProduct);

      expect(highScore.scoreBreakdown.engagementQuality).toBeGreaterThan(
        lowScore.scoreBreakdown.engagementQuality
      );
    });

    it("should favour creators with higher UK audience share", () => {
      const ukCreator = makeCreator({
        creatorId: "uk",
        demographics: {
          topCountries: [{ country: "GB", percentage: 0.9 }],
          ageDistribution: [],
          genderDistribution: [],
        },
      });

      const usCreator = makeCreator({
        creatorId: "us",
        demographics: {
          topCountries: [{ country: "US", percentage: 0.9 }],
          ageDistribution: [],
          genderDistribution: [],
        },
      });

      const ukScore = engine.scoreCreatorProduct(ukCreator, testProduct);
      const usScore = engine.scoreCreatorProduct(usCreator, testProduct);

      expect(ukScore.scoreBreakdown.audienceOverlap).toBeGreaterThan(
        usScore.scoreBreakdown.audienceOverlap
      );
    });

    it("should return full score breakdown", () => {
      const result = engine.scoreCreatorProduct(makeCreator(), testProduct);

      expect(result.scoreBreakdown).toHaveProperty("nicheAlignment");
      expect(result.scoreBreakdown).toHaveProperty("engagementQuality");
      expect(result.scoreBreakdown).toHaveProperty("audienceOverlap");
      expect(result.scoreBreakdown).toHaveProperty("conversionPotential");

      // Each component should be 0-100
      Object.values(result.scoreBreakdown).forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });
  });

  describe("rankCreatorsForProduct", () => {
    it("should return ranked results in descending score order", () => {
      const creators = [
        makeCreator({
          creatorId: "low",
          handle: "@low",
          nicheTags: ["cooking"],
          engagementMetrics: {
            likes: 100,
            shares: 10,
            comments: 5,
            conversionRate: 0.005,
            avgVideoViews: 2000,
            engagementRate: 0.01,
          },
        }),
        makeCreator({
          creatorId: "high",
          handle: "@high",
          nicheTags: ["supplements", "wellness"],
          engagementMetrics: {
            likes: 10000,
            shares: 2000,
            comments: 800,
            conversionRate: 0.05,
            avgVideoViews: 50000,
            engagementRate: 0.08,
          },
        }),
        makeCreator({
          creatorId: "mid",
          handle: "@mid",
          nicheTags: ["fitness"],
          engagementMetrics: {
            likes: 3000,
            shares: 300,
            comments: 100,
            conversionRate: 0.02,
            avgVideoViews: 15000,
            engagementRate: 0.04,
          },
        }),
      ];

      const ranked = engine.rankCreatorsForProduct(creators, testProduct);

      expect(ranked).toHaveLength(3);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].rank).toBe(2);
      expect(ranked[2].rank).toBe(3);
      expect(ranked[0].matchScore).toBeGreaterThanOrEqual(ranked[1].matchScore);
      expect(ranked[1].matchScore).toBeGreaterThanOrEqual(ranked[2].matchScore);
    });
  });

  describe("rankAllMatches", () => {
    it("should return top N matches per product", () => {
      const creators = [
        makeCreator({ creatorId: "c1", handle: "@c1" }),
        makeCreator({ creatorId: "c2", handle: "@c2" }),
        makeCreator({ creatorId: "c3", handle: "@c3" }),
      ];

      const products = [testProduct];

      const results = engine.rankAllMatches(creators, products, 2);

      expect(results.get("prod-vitamin-d")).toHaveLength(2);
      expect(results.get("prod-vitamin-d")![0].rank).toBe(1);
    });
  });

  describe("Weight tuning", () => {
    it("should allow updating weights at runtime", () => {
      engine.updateWeights({ nicheAlignment: 0.5, engagementQuality: 0.1 });

      const weights = engine.getWeights();
      expect(weights.nicheAlignment).toBe(0.5);
      expect(weights.engagementQuality).toBe(0.1);
      expect(weights.audienceOverlap).toBe(0.25); // unchanged
    });

    it("should change rankings when weights change", () => {
      const nicheCreator = makeCreator({
        creatorId: "niche",
        handle: "@niche",
        nicheTags: ["supplements", "wellness", "immune-support"],
        engagementMetrics: {
          likes: 1000,
          shares: 100,
          comments: 50,
          conversionRate: 0.01,
          avgVideoViews: 5000,
          engagementRate: 0.02,
        },
      });

      const engagementCreator = makeCreator({
        creatorId: "engagement",
        handle: "@engagement",
        nicheTags: ["lifestyle"],
        engagementMetrics: {
          likes: 20000,
          shares: 5000,
          comments: 2000,
          conversionRate: 0.06,
          avgVideoViews: 100000,
          engagementRate: 0.1,
        },
      });

      // Default weights
      const defaultNiche = engine.scoreCreatorProduct(nicheCreator, testProduct);
      const defaultEngagement = engine.scoreCreatorProduct(
        engagementCreator,
        testProduct
      );

      // Now heavily weight niche alignment
      engine.updateWeights({
        nicheAlignment: 0.8,
        engagementQuality: 0.05,
        audienceOverlap: 0.1,
        conversionPotential: 0.05,
      });

      const weightedNiche = engine.scoreCreatorProduct(
        nicheCreator,
        testProduct
      );
      const weightedEngagement = engine.scoreCreatorProduct(
        engagementCreator,
        testProduct
      );

      // With high niche weight, niche creator should gain relative advantage
      const defaultDiff = defaultEngagement.matchScore - defaultNiche.matchScore;
      const weightedDiff =
        weightedEngagement.matchScore - weightedNiche.matchScore;

      expect(weightedDiff).toBeLessThan(defaultDiff);
    });
  });
});
