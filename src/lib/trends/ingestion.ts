/**
 * Trend Ingestion Pipeline
 *
 * Raw Apify data → clean/normalize → store with timestamps and engagement metrics.
 * BullMQ recurring job (trend-ingestion queue) on configurable schedule.
 */

import { Pool } from "pg";
import { Queue } from "bullmq";
import { ApifyTrendClient } from "./apify-client";
import {
  TrendStreamType,
  TrendIngestionConfig,
  StoredTrend,
  TrendingHashtag,
  TrendingSound,
  ViralVideo,
  CreatorStat,
  DEFAULT_SUPER_VIRAL_THRESHOLDS,
  SuperViralThresholds,
} from "./types";

const DEFAULT_INGESTION_CONFIG: TrendIngestionConfig = {
  streams: ["hashtags", "music_sounds", "viral_videos", "creator_stats"],
  region: "GB",
  maxItemsPerStream: 50,
  cronSchedule: "0 */6 * * *", // Every 6 hours
};

export interface IngestionResult {
  stream: TrendStreamType;
  itemsIngested: number;
  superViralCount: number;
  timestamp: Date;
}

export class TrendIngestionPipeline {
  private db: Pool;
  private apifyClient: ApifyTrendClient;
  private config: TrendIngestionConfig;
  private thresholds: SuperViralThresholds;

  constructor(
    db: Pool,
    apifyClient: ApifyTrendClient,
    config?: Partial<TrendIngestionConfig>,
    thresholds?: Partial<SuperViralThresholds>
  ) {
    this.db = db;
    this.apifyClient = apifyClient;
    this.config = { ...DEFAULT_INGESTION_CONFIG, ...config };
    this.thresholds = { ...DEFAULT_SUPER_VIRAL_THRESHOLDS, ...thresholds };
  }

  /**
   * Ensure the trends table exists.
   */
  async ensureTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS trends (
        id SERIAL PRIMARY KEY,
        stream_type TEXT NOT NULL,
        data JSONB NOT NULL,
        engagement_score NUMERIC NOT NULL DEFAULT 0,
        is_super_viral BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_trends_stream_type ON trends (stream_type);
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_trends_super_viral ON trends (is_super_viral) WHERE is_super_viral = true;
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_trends_created_at ON trends (created_at DESC);
    `);
  }

  /**
   * Run a full ingestion cycle across all configured streams.
   */
  async ingestAll(): Promise<IngestionResult[]> {
    await this.ensureTable();
    const results: IngestionResult[] = [];

    for (const stream of this.config.streams) {
      const result = await this.ingestStream(stream);
      results.push(result);
    }

    return results;
  }

  /**
   * Ingest a single stream.
   */
  async ingestStream(stream: TrendStreamType): Promise<IngestionResult> {
    const maxItems = this.config.maxItemsPerStream;
    let items: StoredTrend[] = [];

    switch (stream) {
      case "hashtags": {
        const raw = await this.apifyClient.scrapeHashtags(maxItems);
        items = raw.map((h) => this.normalizeHashtag(h));
        break;
      }
      case "music_sounds": {
        const raw = await this.apifyClient.scrapeSounds(maxItems);
        items = raw.map((s) => this.normalizeSound(s));
        break;
      }
      case "viral_videos": {
        const raw = await this.apifyClient.scrapeViralVideos(maxItems);
        items = raw.map((v) => this.normalizeVideo(v));
        break;
      }
      case "creator_stats": {
        const raw = await this.apifyClient.scrapeCreatorStats(maxItems);
        items = raw.map((c) => this.normalizeCreatorStat(c));
        break;
      }
    }

    // Persist to database
    let superViralCount = 0;
    for (const item of items) {
      if (item.isSuperViral) superViralCount++;
      await this.storeTrend(item);
    }

    return {
      stream,
      itemsIngested: items.length,
      superViralCount,
      timestamp: new Date(),
    };
  }

  /**
   * Store a single trend in the database.
   */
  private async storeTrend(trend: StoredTrend): Promise<number> {
    const result = await this.db.query(
      `INSERT INTO trends (stream_type, data, engagement_score, is_super_viral)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        trend.streamType,
        JSON.stringify(trend.data),
        trend.engagementScore,
        trend.isSuperViral,
      ]
    );
    return result.rows[0].id;
  }

  /**
   * Get recent trends, optionally filtered by stream type.
   */
  async getRecentTrends(
    options?: {
      streamType?: TrendStreamType;
      superViralOnly?: boolean;
      limit?: number;
    }
  ): Promise<StoredTrend[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options?.streamType) {
      conditions.push(`stream_type = $${paramIndex++}`);
      params.push(options.streamType);
    }
    if (options?.superViralOnly) {
      conditions.push(`is_super_viral = true`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options?.limit || 50;

    const result = await this.db.query(
      `SELECT id, stream_type, data, engagement_score, is_super_viral, created_at
       FROM trends ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIndex}`,
      [...params, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      streamType: row.stream_type as TrendStreamType,
      data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
      engagementScore: parseFloat(row.engagement_score),
      isSuperViral: row.is_super_viral,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get super viral trends that haven't been alerted yet.
   */
  async getSuperViralTrends(limit: number = 20): Promise<StoredTrend[]> {
    return this.getRecentTrends({ superViralOnly: true, limit });
  }

  /**
   * Schedule recurring ingestion via BullMQ.
   */
  async scheduleRecurringIngestion(queue: Queue): Promise<void> {
    const cronSchedule =
      this.config.cronSchedule || DEFAULT_INGESTION_CONFIG.cronSchedule!;

    await queue.upsertJobScheduler(
      "trend-ingestion-recurring",
      { pattern: cronSchedule },
      {
        name: "ingest-trends",
        data: {
          streams: this.config.streams,
          region: this.config.region,
          maxItemsPerStream: this.config.maxItemsPerStream,
        },
      }
    );
  }

  // ─── Normalization Functions ───

  private normalizeHashtag(raw: TrendingHashtag): StoredTrend {
    const engagementScore = Math.min(100, (raw.viewCount / 100_000_000) * 100);
    const isSuperViral =
      raw.viewCount >= this.thresholds.hashtagViewCount;

    return {
      id: 0,
      streamType: "hashtags",
      data: raw,
      engagementScore: Math.round(engagementScore * 100) / 100,
      isSuperViral,
      createdAt: raw.scrapedAt,
    };
  }

  private normalizeSound(raw: TrendingSound): StoredTrend {
    const engagementScore = Math.min(
      100,
      (raw.usageCount / 1_000_000) * 100 + raw.growthRate * 10
    );
    const isSuperViral =
      raw.usageCount >= this.thresholds.soundUsageCount;

    return {
      id: 0,
      streamType: "music_sounds",
      data: raw,
      engagementScore: Math.round(engagementScore * 100) / 100,
      isSuperViral,
      createdAt: raw.scrapedAt,
    };
  }

  private normalizeVideo(raw: ViralVideo): StoredTrend {
    const totalEngagement = raw.likes + raw.shares * 3 + raw.comments * 2;
    const engagementScore = Math.min(100, (totalEngagement / 5_000_000) * 100);
    const isSuperViral =
      raw.likes >= this.thresholds.videoLikes ||
      raw.shares >= this.thresholds.videoShares;

    return {
      id: 0,
      streamType: "viral_videos",
      data: raw,
      engagementScore: Math.round(engagementScore * 100) / 100,
      isSuperViral,
      createdAt: raw.scrapedAt,
    };
  }

  private normalizeCreatorStat(raw: CreatorStat): StoredTrend {
    const engagementScore = Math.min(
      100,
      (raw.followerCount / 1_000_000) * 50 + raw.avgEngagement * 500
    );
    const isSuperViral =
      raw.followerCount >= this.thresholds.creatorFollowerCount;

    return {
      id: 0,
      streamType: "creator_stats",
      data: raw,
      engagementScore: Math.round(engagementScore * 100) / 100,
      isSuperViral,
      createdAt: raw.scrapedAt,
    };
  }
}
