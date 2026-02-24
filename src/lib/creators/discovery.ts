/**
 * Creator Discovery Service
 *
 * Searches the TikTok Creator Marketplace using all UK market filters,
 * and stores discovered creators in the local `creators` table.
 *
 * Filters applied (from Architecture Spec):
 * - Minimum 5,000 followers
 * - Maximum 3 account violations
 * - Searchable by: GMV, follower demographics, health/wellness sector performance
 * - Additional: product category, content type, avg video views,
 *   engagement rate, posting frequency, reliability with samples
 */

import { Pool } from "pg";
import {
  TikTokApiClient,
  CreatorProfile,
  CreatorSearchFilters,
} from "@/lib/api/tiktok";
import { DiscoveryRunConfig, DiscoveryRunResult } from "./types";

/** Default discovery filters targeting UK health/wellness creators */
const DEFAULT_DISCOVERY_FILTERS: Partial<CreatorSearchFilters> = {
  minFollowers: 5000,
  maxViolations: 3,
  demographics: { country: "GB" },
  sectorPerformance: { sector: "health_wellness" },
  minEngagementRate: 0.02, // 2% minimum engagement
};

export class CreatorDiscoveryService {
  private tiktokClient: TikTokApiClient;
  private db: Pool;

  constructor(tiktokClient: TikTokApiClient, db: Pool) {
    this.tiktokClient = tiktokClient;
    this.db = db;
  }

  /**
   * Run a discovery sweep: search TikTok for creators matching UK filters,
   * then upsert results into the `creators` table.
   */
  async runDiscovery(
    config: DiscoveryRunConfig = {}
  ): Promise<DiscoveryRunResult> {
    const filters: CreatorSearchFilters = {
      ...DEFAULT_DISCOVERY_FILTERS,
      ...config.filters,
    };

    const maxResults = config.maxResults || 100;
    const persistResults = config.persistResults !== false;

    const allCreators: CreatorProfile[] = [];
    let cursor: string | undefined;

    // Paginate through results
    while (allCreators.length < maxResults) {
      const pageSize = Math.min(20, maxResults - allCreators.length);
      const result = await this.tiktokClient.searchCreators({
        ...filters,
        cursor,
        pageSize,
      });

      allCreators.push(...result.creators);

      if (!result.cursor || result.creators.length === 0) break;
      cursor = result.cursor;
    }

    let newCreators = 0;
    let updatedCreators = 0;

    if (persistResults && allCreators.length > 0) {
      const counts = await this.upsertCreators(allCreators);
      newCreators = counts.new;
      updatedCreators = counts.updated;
    }

    const totalResult = await this.db.query(
      "SELECT COUNT(*) FROM creators"
    );
    const totalInDb = parseInt(totalResult.rows[0].count, 10);

    return {
      creators: allCreators,
      newCreators,
      updatedCreators,
      totalInDb,
      timestamp: new Date(),
    };
  }

  /**
   * Upsert a batch of creators into the database.
   * Uses handle as the unique key — updates existing, inserts new.
   */
  async upsertCreators(
    creators: CreatorProfile[]
  ): Promise<{ new: number; updated: number }> {
    let newCount = 0;
    let updatedCount = 0;

    for (const creator of creators) {
      const result = await this.db.query(
        `INSERT INTO creators (handle, follower_count, engagement_metrics, niche_tags)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (handle) DO UPDATE SET
           follower_count = EXCLUDED.follower_count,
           engagement_metrics = EXCLUDED.engagement_metrics,
           niche_tags = EXCLUDED.niche_tags,
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_new`,
        [
          creator.handle,
          creator.followerCount,
          JSON.stringify(creator.engagementMetrics),
          creator.nicheTags,
        ]
      );

      if (result.rows[0]?.is_new) {
        newCount++;
      } else {
        updatedCount++;
      }
    }

    return { new: newCount, updated: updatedCount };
  }

  /**
   * Get a creator from the local database by handle.
   */
  async getCreatorByHandle(handle: string): Promise<CreatorProfile | null> {
    const result = await this.db.query(
      "SELECT * FROM creators WHERE handle = $1",
      [handle]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return this.rowToCreatorProfile(row);
  }

  /**
   * Get all stored creators, optionally filtered by niche tags.
   */
  async getStoredCreators(
    nicheTags?: string[],
    minEngagementRate?: number
  ): Promise<CreatorProfile[]> {
    let query = "SELECT * FROM creators WHERE 1=1";
    const params: unknown[] = [];

    if (nicheTags && nicheTags.length > 0) {
      params.push(nicheTags);
      query += ` AND niche_tags && $${params.length}`;
    }

    if (minEngagementRate !== undefined) {
      params.push(minEngagementRate);
      query += ` AND (engagement_metrics->>'engagementRate')::float >= $${params.length}`;
    }

    query += " ORDER BY follower_count DESC";

    const result = await this.db.query(query, params);
    return result.rows.map((row) => this.rowToCreatorProfile(row));
  }

  /**
   * Convert a database row to a CreatorProfile.
   */
  private rowToCreatorProfile(row: Record<string, unknown>): CreatorProfile {
    const metrics =
      typeof row.engagement_metrics === "string"
        ? JSON.parse(row.engagement_metrics as string)
        : (row.engagement_metrics as Record<string, unknown>);

    return {
      creatorId: String(row.id),
      handle: row.handle as string,
      displayName: row.handle as string,
      followerCount: row.follower_count as number,
      violationCount: 0,
      engagementMetrics: {
        likes: (metrics.likes as number) || 0,
        shares: (metrics.shares as number) || 0,
        comments: (metrics.comments as number) || 0,
        conversionRate: (metrics.conversionRate as number) || 0,
        avgVideoViews: (metrics.avgVideoViews as number) || 0,
        engagementRate: (metrics.engagementRate as number) || 0,
      },
      nicheTags: (row.niche_tags as string[]) || [],
      demographics: {
        topCountries: [],
        ageDistribution: [],
        genderDistribution: [],
      },
      gmv: 0,
      postingFrequency: "unknown",
      sampleReliability: "unknown",
      bio: "",
    };
  }
}
