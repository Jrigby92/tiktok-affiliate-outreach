/**
 * Trend Module Types
 *
 * Types for Apify TikTok trend data, ingestion, and alerting.
 */

// ─── Four Data Streams (Architecture Spec) ───

export interface TrendingHashtag {
  /** Hashtag text (without #) */
  hashtag: string;
  /** Rank in trending list */
  rank: number;
  /** Region (e.g., 'GB') */
  region: string;
  /** Industry classification */
  industryTag: string;
  /** Total view count */
  viewCount: number;
  /** When this data was scraped */
  scrapedAt: Date;
}

export interface TrendingSound {
  /** Sound/music ID */
  soundId: string;
  /** Sound title */
  title: string;
  /** Artist name */
  artist?: string;
  /** Whether approved for business/commercial use */
  isBusinessApproved: boolean;
  /** Growth rate (percentage increase over period) */
  growthRate: number;
  /** Number of videos using this sound */
  usageCount: number;
  /** When this data was scraped */
  scrapedAt: Date;
}

export interface ViralVideo {
  /** TikTok video ID */
  videoId: string;
  /** Video URL */
  url: string;
  /** Creator handle */
  creatorHandle: string;
  /** Number of likes */
  likes: number;
  /** Number of shares */
  shares: number;
  /** Number of comments */
  comments: number;
  /** AI-generated transcript summary */
  transcriptSummary: string;
  /** Hashtags used */
  hashtags: string[];
  /** Sound used */
  soundId?: string;
  /** When this data was scraped */
  scrapedAt: Date;
}

export interface CreatorStat {
  /** TikTok handle */
  handle: string;
  /** Follower count at time of scrape */
  followerCount: number;
  /** Average engagement rate */
  avgEngagement: number;
  /** Keywords from bio */
  bioKeywords: string[];
  /** When this data was scraped */
  scrapedAt: Date;
}

// ─── Apify Configuration ───

export interface ApifyActorConfig {
  /** Apify actor ID (e.g., "apify/tiktok-hashtag-scraper") */
  actorId: string;
  /** Input configuration for the actor run */
  input: Record<string, unknown>;
  /** Timeout in seconds */
  timeoutSecs?: number;
  /** Memory limit in MB */
  memoryMbytes?: number;
  /** Use residential proxies for stealth */
  useResidentialProxy: boolean;
}

export type TrendStreamType =
  | "hashtags"
  | "music_sounds"
  | "viral_videos"
  | "creator_stats";

export interface TrendIngestionConfig {
  /** Which streams to ingest */
  streams: TrendStreamType[];
  /** Region filter */
  region: string;
  /** How many items per stream */
  maxItemsPerStream: number;
  /** BullMQ repeat schedule (cron expression) */
  cronSchedule?: string;
}

// ─── Stored Trend Data ───

export interface StoredTrend {
  id: number;
  streamType: TrendStreamType;
  data: TrendingHashtag | TrendingSound | ViralVideo | CreatorStat;
  engagementScore: number;
  isSuperViral: boolean;
  createdAt: Date;
}

// ─── Super Viral Alert ───

export interface SuperViralAlert {
  /** Trend that triggered the alert */
  trend: StoredTrend;
  /** Why it was flagged */
  reason: string;
  /** Engagement stats at time of alert */
  engagementStats: Record<string, number>;
  /** Suggested product alignment */
  suggestedProduct?: string;
  /** When the alert was fired */
  alertedAt: Date;
}

export interface AlertConfig {
  /** Slack webhook URL */
  slackWebhookUrl?: string;
  /** Email recipients */
  emailRecipients?: string[];
  /** Email sender address */
  emailFrom?: string;
  /** Super viral thresholds per stream type */
  thresholds: SuperViralThresholds;
}

export interface SuperViralThresholds {
  /** Hashtag view count threshold */
  hashtagViewCount: number;
  /** Sound usage count threshold */
  soundUsageCount: number;
  /** Video likes threshold */
  videoLikes: number;
  /** Video shares threshold */
  videoShares: number;
  /** Creator follower count threshold */
  creatorFollowerCount: number;
}

export const DEFAULT_SUPER_VIRAL_THRESHOLDS: SuperViralThresholds = {
  hashtagViewCount: 50_000_000,
  soundUsageCount: 500_000,
  videoLikes: 1_000_000,
  videoShares: 100_000,
  creatorFollowerCount: 500_000,
};
