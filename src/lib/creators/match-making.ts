/**
 * Match-Making Engine
 *
 * Scores each discovered creator against the product catalogue.
 * Output: ranked creator-product pairs with match scores.
 *
 * Scoring dimensions (configurable weights):
 * - Niche alignment via tag intersection
 * - Engagement quality from JSONB metrics
 * - Audience / demographic overlap
 * - Conversion potential (historical conversion rate + GMV)
 */

import { Pool } from "pg";
import type { CreatorProfile } from "@/lib/api/tiktok/types";
import type {
  ProductCatalogEntry,
  CreatorProductMatch,
  MatchWeights,
} from "./types";

const DEFAULT_WEIGHTS: MatchWeights = {
  nicheAlignment: 0.3,
  engagementQuality: 0.25,
  audienceOverlap: 0.25,
  conversionPotential: 0.2,
};

export class MatchMakingEngine {
  private db: Pool;
  private weights: MatchWeights;

  constructor(db: Pool, weights?: Partial<MatchWeights>) {
    this.db = db;
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Score a single creator against a single product.
   * Returns a CreatorProductMatch with a normalised 0-100 score.
   */
  scoreCreatorProduct(
    creator: CreatorProfile,
    product: ProductCatalogEntry
  ): CreatorProductMatch {
    const nicheAlignment = this.computeNicheAlignment(
      creator.nicheTags,
      product.nicheTags
    );

    const engagementScore = this.computeEngagementScore(
      creator.engagementMetrics
    );

    const demographicOverlap = this.computeDemographicOverlap(
      creator,
      product
    );

    const conversionPotential = this.computeConversionPotential(creator);

    const totalScore =
      nicheAlignment * this.weights.nicheAlignment +
      engagementScore * this.weights.engagementQuality +
      demographicOverlap * this.weights.audienceOverlap +
      conversionPotential * this.weights.conversionPotential;

    return {
      creatorId: creator.creatorId,
      productId: product.productId,
      matchScore: Math.round(totalScore * 100) / 100,
      scoreBreakdown: {
        nicheAlignment: Math.round(nicheAlignment * 100) / 100,
        engagementQuality: Math.round(engagementScore * 100) / 100,
        audienceOverlap: Math.round(demographicOverlap * 100) / 100,
        conversionPotential: Math.round(conversionPotential * 100) / 100,
      },
    };
  }

  /**
   * Rank all creators for a given product (highest match score first).
   */
  rankCreatorsForProduct(
    creators: CreatorProfile[],
    product: ProductCatalogEntry
  ): CreatorProductMatch[] {
    return creators
      .map((creator) => this.scoreCreatorProduct(creator, product))
      .sort((a, b) => b.matchScore - a.matchScore)
      .map((match, index) => ({ ...match, rank: index + 1 }));
  }

  /**
   * Rank all creators against all products, returning the top N matches per product.
   */
  rankAllMatches(
    creators: CreatorProfile[],
    products: ProductCatalogEntry[],
    topN: number
  ): Map<string, CreatorProductMatch[]> {
    const results = new Map<string, CreatorProductMatch[]>();

    for (const product of products) {
      const ranked = this.rankCreatorsForProduct(creators, product);
      results.set(product.productId, ranked.slice(0, topN));
    }

    return results;
  }

  /**
   * Persist match results to the `creator_product_matches` table.
   * Uses an upsert so re-running is idempotent.
   */
  async persistMatches(matches: CreatorProductMatch[]): Promise<void> {
    if (matches.length === 0) return;

    for (const match of matches) {
      await this.db.query(
        `INSERT INTO creator_product_matches
           (creator_id, product_id, match_score, score_breakdown)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (creator_id, product_id) DO UPDATE SET
           match_score = EXCLUDED.match_score,
           score_breakdown = EXCLUDED.score_breakdown,
           updated_at = NOW()`,
        [
          match.creatorId,
          match.productId,
          match.matchScore,
          JSON.stringify(match.scoreBreakdown),
        ]
      );
    }
  }

  /**
   * Update scoring weights at runtime (e.g. from RL feedback loop).
   */
  updateWeights(newWeights: Partial<MatchWeights>): void {
    this.weights = { ...this.weights, ...newWeights };
  }

  /** Return a copy of current weights */
  getWeights(): MatchWeights {
    return { ...this.weights };
  }

  // ------------------------------------------------------------------
  // Private scoring helpers
  // ------------------------------------------------------------------

  /**
   * Niche alignment: Jaccard similarity between creator tags and product tags.
   * Returns 0-100.
   */
  private computeNicheAlignment(
    creatorTags: string[],
    productTags: string[]
  ): number {
    if (creatorTags.length === 0 && productTags.length === 0) return 0;

    const creatorSet = new Set(creatorTags.map((t) => t.toLowerCase()));
    const productSet = new Set(productTags.map((t) => t.toLowerCase()));

    let intersectionSize = 0;
    for (const tag of creatorSet) {
      if (productSet.has(tag)) intersectionSize++;
    }

    const unionSize = new Set([...creatorSet, ...productSet]).size;
    if (unionSize === 0) return 0;

    return (intersectionSize / unionSize) * 100;
  }

  /**
   * Engagement quality: composite of engagement rate, avg video views,
   * and like/comment ratio. Returns 0-100.
   */
  private computeEngagementScore(
    metrics: CreatorProfile["engagementMetrics"]
  ): number {
    // Engagement rate contribution (0-50 points)
    // Top-tier TikTok engagement is ~8-15%, so cap at 15%
    const engagementRateScore = Math.min(metrics.engagementRate / 0.15, 1) * 50;

    // Avg video views contribution (0-30 points)
    // 100K views is excellent for a 5K+ follower creator
    const viewsScore = Math.min(metrics.avgVideoViews / 100000, 1) * 30;

    // Interaction depth: comment-to-like ratio (0-20 points)
    // Higher ratio means deeper engagement
    const commentLikeRatio =
      metrics.likes > 0 ? metrics.comments / metrics.likes : 0;
    const interactionScore = Math.min(commentLikeRatio / 0.05, 1) * 20;

    return engagementRateScore + viewsScore + interactionScore;
  }

  /**
   * Demographic overlap: how well the creator's audience matches
   * the product's target audience. Returns 0-100.
   */
  private computeDemographicOverlap(
    creator: CreatorProfile,
    product: ProductCatalogEntry
  ): number {
    let score = 0;

    // UK audience percentage (0-50 points)
    const ukAudience = creator.demographics.topCountries.find(
      (c) => c.country === "GB" || c.country === "UK"
    );
    const ukPercentage = ukAudience?.percentage ?? 0;
    score += Math.min(ukPercentage / 50, 1) * 50;

    // Interest overlap with product target audience (0-50 points)
    if (product.targetAudience.interests.length > 0) {
      const creatorInterestSet = new Set(
        creator.nicheTags.map((t) => t.toLowerCase())
      );
      const productInterestSet = new Set(
        product.targetAudience.interests.map((i) => i.toLowerCase())
      );

      let interestOverlap = 0;
      for (const interest of productInterestSet) {
        if (creatorInterestSet.has(interest)) interestOverlap++;
      }

      const overlapRatio =
        productInterestSet.size > 0
          ? interestOverlap / productInterestSet.size
          : 0;
      score += overlapRatio * 50;
    }

    return score;
  }

  /**
   * Conversion potential: based on historical conversion rate and GMV.
   * Returns 0-100.
   */
  private computeConversionPotential(creator: CreatorProfile): number {
    // Conversion rate contribution (0-60 points)
    // A 5% conversion rate is outstanding for affiliates
    const conversionScore =
      Math.min(creator.engagementMetrics.conversionRate / 0.05, 1) * 60;

    // GMV contribution (0-40 points)
    // £10,000 GMV is a strong track record
    const gmvScore = Math.min(creator.gmv / 10000, 1) * 40;

    return conversionScore + gmvScore;
  }
}
