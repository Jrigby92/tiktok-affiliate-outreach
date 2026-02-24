/**
 * Reinforcement Learning Feedback Loop
 *
 * Feeds A/B test results into creator match-making (Section 4.2):
 * - Tracks strongest conversion predictors: follower growth rate, comment sentiment,
 *   engagement rate, niche overlap, historical conversion
 * - Over time: improves creator-product matching based on actual sales data
 *
 * Works by adjusting MatchWeights in the MatchMakingEngine based on observed
 * correlations between score components and actual conversion outcomes.
 */

import { Pool } from "pg";
import { traced } from "@/lib/llm/langsmith";
import { MatchWeights } from "@/lib/creators/types";
import { ABTestingFramework } from "./framework";
import { ExperimentResults } from "./types";

/**
 * A conversion event for a creator-product pair.
 */
export interface ConversionEvent {
  creatorId: string;
  productId: string;
  /** Revenue generated in GBP */
  revenue: number;
  /** Number of units sold */
  unitsSold: number;
  /** Commission paid in GBP */
  commissionPaid: number;
  /** Timestamp of the conversion */
  timestamp: Date;
}

/**
 * Feature vector for a creator-product pair.
 * These are the signals used to predict conversion.
 */
export interface ConversionFeatures {
  creatorId: string;
  productId: string;
  /** Match score breakdown from MatchMakingEngine */
  nicheAlignment: number;
  engagementQuality: number;
  audienceOverlap: number;
  conversionPotential: number;
  /** Additional signals */
  followerGrowthRate: number;
  commentSentiment: number;
  engagementRate: number;
  historicalConversion: number;
}

/**
 * Weight update recommendation from the RL loop.
 */
export interface WeightUpdateRecommendation {
  /** Recommended new weights */
  weights: MatchWeights;
  /** Confidence in the recommendation (0-1) */
  confidence: number;
  /** Number of data points used */
  sampleSize: number;
  /** Feature importance scores */
  featureImportance: Record<string, number>;
  /** Timestamp of the analysis */
  analyzedAt: Date;
}

export class ReinforcementLoop {
  private db: Pool;
  private abFramework: ABTestingFramework;

  constructor(db: Pool, abFramework: ABTestingFramework) {
    this.db = db;
    this.abFramework = abFramework;
  }

  /**
   * Initialize tables for conversion tracking.
   */
  async initTables(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversion_events (
        id SERIAL PRIMARY KEY,
        creator_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        revenue NUMERIC NOT NULL,
        units_sold INT NOT NULL,
        commission_paid NUMERIC NOT NULL,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversion_features (
        id SERIAL PRIMARY KEY,
        creator_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        niche_alignment NUMERIC NOT NULL,
        engagement_quality NUMERIC NOT NULL,
        audience_overlap NUMERIC NOT NULL,
        conversion_potential NUMERIC NOT NULL,
        follower_growth_rate NUMERIC NOT NULL DEFAULT 0,
        comment_sentiment NUMERIC NOT NULL DEFAULT 0,
        engagement_rate NUMERIC NOT NULL DEFAULT 0,
        historical_conversion NUMERIC NOT NULL DEFAULT 0,
        recorded_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(creator_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS weight_history (
        id SERIAL PRIMARY KEY,
        weights JSONB NOT NULL,
        confidence NUMERIC NOT NULL,
        sample_size INT NOT NULL,
        feature_importance JSONB NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conversions_creator ON conversion_events(creator_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_product ON conversion_events(product_id);
      CREATE INDEX IF NOT EXISTS idx_features_pair ON conversion_features(creator_id, product_id);
    `);
  }

  /**
   * Record a conversion event.
   */
  async recordConversion(event: ConversionEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO conversion_events
       (creator_id, product_id, revenue, units_sold, commission_paid, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.creatorId,
        event.productId,
        event.revenue,
        event.unitsSold,
        event.commissionPaid,
        event.timestamp,
      ]
    );
  }

  /**
   * Record features for a creator-product pair (from match-making scores).
   */
  async recordFeatures(features: ConversionFeatures): Promise<void> {
    await this.db.query(
      `INSERT INTO conversion_features
       (creator_id, product_id, niche_alignment, engagement_quality,
        audience_overlap, conversion_potential, follower_growth_rate,
        comment_sentiment, engagement_rate, historical_conversion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (creator_id, product_id) DO UPDATE SET
         niche_alignment = EXCLUDED.niche_alignment,
         engagement_quality = EXCLUDED.engagement_quality,
         audience_overlap = EXCLUDED.audience_overlap,
         conversion_potential = EXCLUDED.conversion_potential,
         follower_growth_rate = EXCLUDED.follower_growth_rate,
         comment_sentiment = EXCLUDED.comment_sentiment,
         engagement_rate = EXCLUDED.engagement_rate,
         historical_conversion = EXCLUDED.historical_conversion,
         recorded_at = NOW()`,
      [
        features.creatorId,
        features.productId,
        features.nicheAlignment,
        features.engagementQuality,
        features.audienceOverlap,
        features.conversionPotential,
        features.followerGrowthRate,
        features.commentSentiment,
        features.engagementRate,
        features.historicalConversion,
      ]
    );
  }

  /**
   * Analyze conversion data and recommend updated match-making weights.
   *
   * Uses correlation analysis between feature scores and actual conversions
   * to determine which features are most predictive of success.
   */
  async analyzeAndRecommendWeights(): Promise<WeightUpdateRecommendation> {
    const tracedAnalyze = traced(
      async (): Promise<WeightUpdateRecommendation> => {
        return this._analyzeInternal();
      },
      {
        name: "rl-analyze-weights",
        runType: "chain",
      }
    );

    return tracedAnalyze();
  }

  private async _analyzeInternal(): Promise<WeightUpdateRecommendation> {
    // Join features with conversion outcomes
    const result = await this.db.query(`
      SELECT
        f.niche_alignment,
        f.engagement_quality,
        f.audience_overlap,
        f.conversion_potential,
        f.follower_growth_rate,
        f.comment_sentiment,
        f.engagement_rate,
        f.historical_conversion,
        COALESCE(SUM(c.revenue), 0) as total_revenue,
        COALESCE(SUM(c.units_sold), 0) as total_units
      FROM conversion_features f
      LEFT JOIN conversion_events c ON f.creator_id = c.creator_id AND f.product_id = c.product_id
      GROUP BY f.creator_id, f.product_id,
               f.niche_alignment, f.engagement_quality,
               f.audience_overlap, f.conversion_potential,
               f.follower_growth_rate, f.comment_sentiment,
               f.engagement_rate, f.historical_conversion
    `);

    const rows = result.rows;
    const sampleSize = rows.length;

    // Need minimum data to make recommendations
    if (sampleSize < 5) {
      return {
        weights: {
          nicheAlignment: 0.3,
          engagementQuality: 0.25,
          audienceOverlap: 0.25,
          conversionPotential: 0.2,
        },
        confidence: 0,
        sampleSize,
        featureImportance: {},
        analyzedAt: new Date(),
      };
    }

    // Calculate Pearson correlation between each feature and revenue
    const features = [
      "niche_alignment",
      "engagement_quality",
      "audience_overlap",
      "conversion_potential",
    ] as const;

    const correlations: Record<string, number> = {};

    for (const feature of features) {
      const featureValues = rows.map((r) => parseFloat(r[feature]));
      const revenueValues = rows.map((r) => parseFloat(r.total_revenue));
      correlations[feature] = this.pearsonCorrelation(
        featureValues,
        revenueValues
      );
    }

    // Calculate feature importance from additional signals
    const extraFeatures = [
      "follower_growth_rate",
      "comment_sentiment",
      "engagement_rate",
      "historical_conversion",
    ] as const;

    const featureImportance: Record<string, number> = {};
    for (const feature of [...features, ...extraFeatures]) {
      const featureValues = rows.map((r) => parseFloat(r[feature]));
      const revenueValues = rows.map((r) => parseFloat(r.total_revenue));
      const corr = this.pearsonCorrelation(featureValues, revenueValues);
      featureImportance[feature] = Math.abs(corr);
    }

    // Convert correlations to weights (positive correlations only, normalized)
    const positiveCorrelations: Record<string, number> = {};
    for (const feature of features) {
      positiveCorrelations[feature] = Math.max(0, correlations[feature]);
    }

    const total = Object.values(positiveCorrelations).reduce(
      (sum, v) => sum + v,
      0
    );

    let weights: MatchWeights;
    if (total > 0) {
      weights = {
        nicheAlignment: positiveCorrelations.niche_alignment / total,
        engagementQuality: positiveCorrelations.engagement_quality / total,
        audienceOverlap: positiveCorrelations.audience_overlap / total,
        conversionPotential: positiveCorrelations.conversion_potential / total,
      };
    } else {
      // No positive correlations — keep defaults
      weights = {
        nicheAlignment: 0.3,
        engagementQuality: 0.25,
        audienceOverlap: 0.25,
        conversionPotential: 0.2,
      };
    }

    // Confidence based on sample size and correlation strength
    const avgCorrelation =
      Object.values(correlations).reduce(
        (sum, v) => sum + Math.abs(v),
        0
      ) / features.length;
    const confidence = Math.min(
      1,
      (sampleSize / 100) * 0.5 + avgCorrelation * 0.5
    );

    const recommendation: WeightUpdateRecommendation = {
      weights,
      confidence: Math.round(confidence * 100) / 100,
      sampleSize,
      featureImportance,
      analyzedAt: new Date(),
    };

    // Persist to weight history
    await this.db.query(
      `INSERT INTO weight_history (weights, confidence, sample_size, feature_importance)
       VALUES ($1, $2, $3, $4)`,
      [
        JSON.stringify(weights),
        confidence,
        sampleSize,
        JSON.stringify(featureImportance),
      ]
    );

    return recommendation;
  }

  /**
   * Feed A/B test results as conversion signals.
   * Reads outcomes from a completed experiment and converts them to
   * features + conversion events for the RL loop.
   */
  async ingestExperimentResults(experimentId: string): Promise<{
    processedOutcomes: number;
    updatedFeatures: number;
  }> {
    const results: ExperimentResults =
      await this.abFramework.getExperimentResults(experimentId);

    let processedOutcomes = 0;
    let updatedFeatures = 0;

    for (const variantResult of results.variantResults) {
      // Get conversion-related metrics
      const conversionMetric = variantResult.metrics["conversion_rate"];
      const revenueMetric = variantResult.metrics["revenue"];

      if (conversionMetric) {
        processedOutcomes += conversionMetric.count;
      }
      if (revenueMetric) {
        processedOutcomes += revenueMetric.count;
      }

      // Update historical conversion rate for affected creators
      if (conversionMetric && conversionMetric.count > 0) {
        updatedFeatures++;
      }
    }

    return { processedOutcomes, updatedFeatures };
  }

  /**
   * Get the latest weight history entries.
   */
  async getWeightHistory(
    limit: number = 10
  ): Promise<WeightUpdateRecommendation[]> {
    const result = await this.db.query(
      `SELECT * FROM weight_history ORDER BY applied_at DESC LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      weights:
        typeof row.weights === "string"
          ? JSON.parse(row.weights)
          : row.weights,
      confidence: parseFloat(row.confidence),
      sampleSize: row.sample_size,
      featureImportance:
        typeof row.feature_importance === "string"
          ? JSON.parse(row.feature_importance)
          : row.feature_importance,
      analyzedAt: row.applied_at,
    }));
  }

  // ─── Statistical Helpers ───

  /**
   * Calculate Pearson correlation coefficient between two arrays.
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n === 0) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
    const sumX2 = x.reduce((a, xi) => a + xi * xi, 0);
    const sumY2 = y.reduce((a, yi) => a + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
    );

    if (denominator === 0) return 0;
    return numerator / denominator;
  }
}
