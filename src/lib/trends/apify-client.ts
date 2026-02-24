/**
 * Apify Actor Integration for TikTok Trend Scraping
 *
 * Four data streams (Architecture Spec):
 * - Hashtags: rank, region, industry_tag, view_count
 * - Music/Sounds: is_business_approved, growth_rate, usage_count
 * - Viral Videos: likes, shares, comments, transcript_summary
 * - Creator Stats: follower_count, avg_engagement, bio_keywords
 *
 * Stealth mode: residential proxies + browser automation.
 * TikTok has aggressive anti-bot detection.
 */

import {
  TrendingHashtag,
  TrendingSound,
  ViralVideo,
  CreatorStat,
  ApifyActorConfig,
  TrendStreamType,
} from "./types";

// ─── Actor IDs for each stream ───

const ACTOR_IDS: Record<TrendStreamType, string> = {
  hashtags: "clockworks/tiktok-hashtag-scraper",
  music_sounds: "clockworks/tiktok-sound-scraper",
  viral_videos: "clockworks/tiktok-scraper",
  creator_stats: "clockworks/tiktok-profile-scraper",
};

export interface ApifyClientOptions {
  /** Apify API token */
  apiToken: string;
  /** Base URL for Apify API */
  baseUrl?: string;
  /** Default timeout in seconds */
  defaultTimeoutSecs?: number;
  /** Region for trend data */
  region?: string;
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface ApifyDatasetResponse {
  // Apify returns dynamic, untyped actor results
  items: any[]; // eslint-disable-line
}

export class ApifyTrendClient {
  private apiToken: string;
  private baseUrl: string;
  private defaultTimeoutSecs: number;
  private region: string;

  constructor(options: ApifyClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = options.baseUrl || "https://api.apify.com/v2";
    this.defaultTimeoutSecs = options.defaultTimeoutSecs || 300;
    this.region = options.region || "GB";
  }

  /**
   * Run an Apify actor and collect results.
   */
  private async runActor(config: ApifyActorConfig): Promise<any[]> { // eslint-disable-line
    // Start the actor run
    const runResponse = await fetch(
      `${this.baseUrl}/acts/${config.actorId}/runs?token=${this.apiToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config.input,
          timeoutSecs: config.timeoutSecs || this.defaultTimeoutSecs,
          memoryMbytes: config.memoryMbytes || 4096,
          ...(config.useResidentialProxy
            ? {
                proxyConfiguration: {
                  useApifyProxy: true,
                  apifyProxyGroups: ["RESIDENTIAL"],
                },
              }
            : {}),
        }),
      }
    );

    if (!runResponse.ok) {
      throw new Error(
        `Apify actor run failed: ${runResponse.status} ${runResponse.statusText}`
      );
    }

    const runData = (await runResponse.json()) as ApifyRunResponse;
    const runId = runData.data.id;

    // Wait for actor to finish
    const finalStatus = await this.waitForRun(runId, config.timeoutSecs);
    if (finalStatus !== "SUCCEEDED") {
      throw new Error(`Apify actor run did not succeed: status=${finalStatus}`);
    }

    // Fetch dataset results
    const datasetId = runData.data.defaultDatasetId;
    const dataResponse = await fetch(
      `${this.baseUrl}/datasets/${datasetId}/items?token=${this.apiToken}&format=json`
    );

    if (!dataResponse.ok) {
      throw new Error(
        `Failed to fetch dataset: ${dataResponse.status} ${dataResponse.statusText}`
      );
    }

    const dataset = (await dataResponse.json()) as ApifyDatasetResponse;
    return dataset.items || (dataset as unknown as Record<string, unknown>[]);
  }

  /**
   * Poll for actor run completion.
   */
  private async waitForRun(
    runId: string,
    timeoutSecs?: number
  ): Promise<string> {
    const timeout = (timeoutSecs || this.defaultTimeoutSecs) * 1000;
    const start = Date.now();
    const pollInterval = 5000;

    while (Date.now() - start < timeout) {
      const response = await fetch(
        `${this.baseUrl}/actor-runs/${runId}?token=${this.apiToken}`
      );

      if (response.ok) {
        const data = (await response.json()) as { data: { status: string } };
        const status = data.data.status;
        if (
          status === "SUCCEEDED" ||
          status === "FAILED" ||
          status === "ABORTED" ||
          status === "TIMED-OUT"
        ) {
          return status;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Actor run ${runId} timed out after ${timeoutSecs}s`);
  }

  /**
   * Build actor config for a specific stream.
   */
  getActorConfig(
    stream: TrendStreamType,
    maxItems: number = 50
  ): ApifyActorConfig {
    const base: Partial<ApifyActorConfig> = {
      actorId: ACTOR_IDS[stream],
      timeoutSecs: this.defaultTimeoutSecs,
      memoryMbytes: 4096,
      useResidentialProxy: true,
    };

    switch (stream) {
      case "hashtags":
        return {
          ...base,
          actorId: ACTOR_IDS.hashtags,
          useResidentialProxy: true,
          input: {
            region: this.region,
            maxItems,
            sortBy: "popularity",
          },
        };
      case "music_sounds":
        return {
          ...base,
          actorId: ACTOR_IDS.music_sounds,
          useResidentialProxy: true,
          input: {
            region: this.region,
            maxItems,
            includeBusinessInfo: true,
          },
        };
      case "viral_videos":
        return {
          ...base,
          actorId: ACTOR_IDS.viral_videos,
          useResidentialProxy: true,
          input: {
            region: this.region,
            maxItems,
            sortBy: "likes",
            includeTranscript: true,
          },
        };
      case "creator_stats":
        return {
          ...base,
          actorId: ACTOR_IDS.creator_stats,
          useResidentialProxy: true,
          input: {
            region: this.region,
            maxItems,
            categories: ["health", "wellness", "fitness", "supplements"],
          },
        };
    }
  }

  /**
   * Scrape trending hashtags.
   */
  async scrapeHashtags(maxItems: number = 50): Promise<TrendingHashtag[]> {
    const config = this.getActorConfig("hashtags", maxItems);
    const raw = await this.runActor(config);

    return raw.map((item, index) => ({
      hashtag: String(item.name || item.hashtag || ""),
      rank: Number(item.rank || index + 1),
      region: String(item.region || this.region),
      industryTag: String(item.industryTag || item.industry || "general"),
      viewCount: Number(item.viewCount || item.views || 0),
      scrapedAt: new Date(),
    }));
  }

  /**
   * Scrape trending music/sounds.
   */
  async scrapeSounds(maxItems: number = 50): Promise<TrendingSound[]> {
    const config = this.getActorConfig("music_sounds", maxItems);
    const raw = await this.runActor(config);

    return raw.map((item) => ({
      soundId: String(item.id || item.soundId || ""),
      title: String(item.title || item.name || ""),
      artist: item.artist ? String(item.artist) : undefined,
      isBusinessApproved: Boolean(
        item.isBusinessApproved ?? item.commercialUse ?? false
      ),
      growthRate: Number(item.growthRate || item.growth || 0),
      usageCount: Number(item.usageCount || item.videoCount || 0),
      scrapedAt: new Date(),
    }));
  }

  /**
   * Scrape viral videos.
   */
  async scrapeViralVideos(maxItems: number = 50): Promise<ViralVideo[]> {
    const config = this.getActorConfig("viral_videos", maxItems);
    const raw = await this.runActor(config);

    return raw.map((item) => ({
      videoId: String(item.id || item.videoId || ""),
      url: String(item.url || item.webVideoUrl || ""),
      creatorHandle: String(
        item.authorMeta?.name || item.creatorHandle || item.author || ""
      ),
      likes: Number(item.diggCount || item.likes || 0),
      shares: Number(item.shareCount || item.shares || 0),
      comments: Number(item.commentCount || item.comments || 0),
      transcriptSummary: String(item.transcript || item.text || ""),
      hashtags: Array.isArray(item.hashtags)
        ? item.hashtags.map(
            (h: string | { name: string }) =>
              typeof h === "string" ? h : h.name
          )
        : [],
      soundId: item.musicMeta?.musicId
        ? String(item.musicMeta.musicId)
        : undefined,
      scrapedAt: new Date(),
    }));
  }

  /**
   * Scrape creator stats.
   */
  async scrapeCreatorStats(maxItems: number = 50): Promise<CreatorStat[]> {
    const config = this.getActorConfig("creator_stats", maxItems);
    const raw = await this.runActor(config);

    return raw.map((item) => ({
      handle: String(item.uniqueId || item.handle || item.username || ""),
      followerCount: Number(item.fans || item.followerCount || 0),
      avgEngagement: Number(
        item.avgEngagement || item.engagementRate || 0
      ),
      bioKeywords: this.extractBioKeywords(
        String(item.signature || item.bio || "")
      ),
      scrapedAt: new Date(),
    }));
  }

  /**
   * Scrape all four streams.
   */
  async scrapeAll(
    maxItemsPerStream: number = 50
  ): Promise<{
    hashtags: TrendingHashtag[];
    sounds: TrendingSound[];
    viralVideos: ViralVideo[];
    creatorStats: CreatorStat[];
  }> {
    const [hashtags, sounds, viralVideos, creatorStats] = await Promise.all([
      this.scrapeHashtags(maxItemsPerStream),
      this.scrapeSounds(maxItemsPerStream),
      this.scrapeViralVideos(maxItemsPerStream),
      this.scrapeCreatorStats(maxItemsPerStream),
    ]);

    return { hashtags, sounds, viralVideos, creatorStats };
  }

  /**
   * Extract keywords from a bio string.
   */
  private extractBioKeywords(bio: string): string[] {
    if (!bio) return [];

    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "is",
      "am",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "i",
      "my",
      "me",
      "we",
      "you",
      "your",
      "it",
      "its",
      "this",
      "that",
    ]);

    return bio
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .slice(0, 20);
  }
}
