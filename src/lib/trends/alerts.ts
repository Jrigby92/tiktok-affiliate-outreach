/**
 * Super Viral Detection & Alerting
 *
 * Configurable engagement threshold. When exceeded:
 * - Instant alert via Slack webhook
 * - Instant alert via email
 * - Includes: content URL/ID, engagement stats, why flagged, suggested product alignment
 */

import {
  StoredTrend,
  SuperViralAlert,
  AlertConfig,
  TrendingHashtag,
  TrendingSound,
  ViralVideo,
  CreatorStat,
  DEFAULT_SUPER_VIRAL_THRESHOLDS,
} from "./types";

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  thresholds: DEFAULT_SUPER_VIRAL_THRESHOLDS,
};

export class SuperViralDetector {
  private config: AlertConfig;

  constructor(config?: Partial<AlertConfig>) {
    this.config = {
      ...DEFAULT_ALERT_CONFIG,
      ...config,
      thresholds: {
        ...DEFAULT_SUPER_VIRAL_THRESHOLDS,
        ...config?.thresholds,
      },
    };
  }

  /**
   * Check a batch of trends for super viral items and fire alerts.
   */
  async detectAndAlert(trends: StoredTrend[]): Promise<SuperViralAlert[]> {
    const alerts: SuperViralAlert[] = [];

    for (const trend of trends) {
      if (trend.isSuperViral) {
        const alert = this.buildAlert(trend);
        alerts.push(alert);
      }
    }

    // Fire alerts for all super viral trends
    if (alerts.length > 0) {
      await Promise.all([
        this.sendSlackAlerts(alerts),
        this.sendEmailAlerts(alerts),
      ]);
    }

    return alerts;
  }

  /**
   * Build a structured alert from a super viral trend.
   */
  buildAlert(trend: StoredTrend): SuperViralAlert {
    const engagementStats = this.extractEngagementStats(trend);
    const reason = this.buildFlagReason(trend);
    const suggestedProduct = this.suggestProductAlignment(trend);

    return {
      trend,
      reason,
      engagementStats,
      suggestedProduct,
      alertedAt: new Date(),
    };
  }

  /**
   * Send alerts to Slack via webhook.
   */
  async sendSlackAlerts(alerts: SuperViralAlert[]): Promise<void> {
    if (!this.config.slackWebhookUrl) return;

    for (const alert of alerts) {
      const message = this.formatSlackMessage(alert);

      await fetch(this.config.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      });
    }
  }

  /**
   * Send alerts via email (uses a configurable transport).
   */
  async sendEmailAlerts(alerts: SuperViralAlert[]): Promise<void> {
    if (
      !this.config.emailRecipients ||
      this.config.emailRecipients.length === 0
    )
      return;

    for (const alert of alerts) {
      const subject = `[SUPER VIRAL] ${this.getAlertTitle(alert)}`;
      const body = this.formatEmailBody(alert);

      // Use fetch to a configured email API endpoint
      // In production, this would be SendGrid, AWS SES, etc.
      const emailEndpoint =
        process.env.EMAIL_API_ENDPOINT || "http://localhost:3000/api/email";

      await fetch(emailEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: this.config.emailFrom || "alerts@andinn-organics.co.uk",
          to: this.config.emailRecipients,
          subject,
          html: body,
        }),
      });
    }
  }

  // ─── Alert Formatting ───

  private formatSlackMessage(
    alert: SuperViralAlert
  ): Record<string, unknown> {
    const title = this.getAlertTitle(alert);
    const stats = Object.entries(alert.engagementStats)
      .map(([k, v]) => `*${k}:* ${v.toLocaleString()}`)
      .join("\n");

    return {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🔥 SUPER VIRAL: ${title}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Why flagged:* ${alert.reason}\n\n${stats}`,
          },
        },
        ...(alert.suggestedProduct
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Suggested product alignment:* ${alert.suggestedProduct}`,
                },
              },
            ]
          : []),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Stream: ${alert.trend.streamType} | Score: ${alert.trend.engagementScore} | ${alert.alertedAt.toISOString()}`,
            },
          ],
        },
      ],
    };
  }

  private formatEmailBody(alert: SuperViralAlert): string {
    const title = this.getAlertTitle(alert);
    const stats = Object.entries(alert.engagementStats)
      .map(([k, v]) => `<li><strong>${k}:</strong> ${v.toLocaleString()}</li>`)
      .join("");

    return `
      <h2>🔥 Super Viral Alert: ${title}</h2>
      <p><strong>Why flagged:</strong> ${alert.reason}</p>
      <h3>Engagement Stats:</h3>
      <ul>${stats}</ul>
      ${alert.suggestedProduct ? `<p><strong>Suggested product alignment:</strong> ${alert.suggestedProduct}</p>` : ""}
      <hr>
      <p><small>Stream: ${alert.trend.streamType} | Score: ${alert.trend.engagementScore} | ${alert.alertedAt.toISOString()}</small></p>
    `;
  }

  private getAlertTitle(alert: SuperViralAlert): string {
    const data = alert.trend.data;

    switch (alert.trend.streamType) {
      case "hashtags":
        return `#${(data as TrendingHashtag).hashtag}`;
      case "music_sounds":
        return (data as TrendingSound).title;
      case "viral_videos":
        return `Video by @${(data as ViralVideo).creatorHandle}`;
      case "creator_stats":
        return `@${(data as CreatorStat).handle}`;
      default:
        return "Unknown trend";
    }
  }

  private extractEngagementStats(
    trend: StoredTrend
  ): Record<string, number> {
    const data = trend.data;

    switch (trend.streamType) {
      case "hashtags":
        return {
          viewCount: (data as TrendingHashtag).viewCount,
          rank: (data as TrendingHashtag).rank,
        };
      case "music_sounds":
        return {
          usageCount: (data as TrendingSound).usageCount,
          growthRate: (data as TrendingSound).growthRate,
        };
      case "viral_videos":
        return {
          likes: (data as ViralVideo).likes,
          shares: (data as ViralVideo).shares,
          comments: (data as ViralVideo).comments,
        };
      case "creator_stats":
        return {
          followerCount: (data as CreatorStat).followerCount,
          avgEngagement: (data as CreatorStat).avgEngagement,
        };
      default:
        return {};
    }
  }

  private buildFlagReason(trend: StoredTrend): string {
    const data = trend.data;
    const t = this.config.thresholds;

    switch (trend.streamType) {
      case "hashtags": {
        const h = data as TrendingHashtag;
        return `Hashtag #${h.hashtag} has ${h.viewCount.toLocaleString()} views (threshold: ${t.hashtagViewCount.toLocaleString()})`;
      }
      case "music_sounds": {
        const s = data as TrendingSound;
        return `Sound "${s.title}" used in ${s.usageCount.toLocaleString()} videos (threshold: ${t.soundUsageCount.toLocaleString()})`;
      }
      case "viral_videos": {
        const v = data as ViralVideo;
        const reasons: string[] = [];
        if (v.likes >= t.videoLikes)
          reasons.push(`${v.likes.toLocaleString()} likes`);
        if (v.shares >= t.videoShares)
          reasons.push(`${v.shares.toLocaleString()} shares`);
        return `Video has ${reasons.join(" and ")} (thresholds: ${t.videoLikes.toLocaleString()} likes / ${t.videoShares.toLocaleString()} shares)`;
      }
      case "creator_stats": {
        const c = data as CreatorStat;
        return `Creator @${c.handle} has ${c.followerCount.toLocaleString()} followers (threshold: ${t.creatorFollowerCount.toLocaleString()})`;
      }
      default:
        return "Engagement exceeds threshold";
    }
  }

  /**
   * Suggest which Andinn Organics product might align with this trend.
   * Based on trend content/category.
   */
  private suggestProductAlignment(trend: StoredTrend): string | undefined {
    const data = trend.data;

    // Extract relevant keywords from the trend
    let keywords: string[] = [];

    switch (trend.streamType) {
      case "hashtags": {
        const h = data as TrendingHashtag;
        keywords = [h.hashtag, h.industryTag].filter(Boolean);
        break;
      }
      case "viral_videos": {
        const v = data as ViralVideo;
        keywords = [...v.hashtags, v.transcriptSummary]
          .filter(Boolean)
          .flatMap((k) => k.toLowerCase().split(/\s+/));
        break;
      }
      case "creator_stats": {
        const c = data as CreatorStat;
        keywords = c.bioKeywords;
        break;
      }
      default:
        return undefined;
    }

    const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

    // Simple keyword-to-product mapping
    const productMappings: Record<string, string[]> = {
      "Vitamin D Supplement": [
        "vitamind",
        "vitamin",
        "sunshine",
        "immune",
        "immunity",
        "winter",
        "health",
      ],
      "Omega-3 Fish Oil": [
        "omega",
        "fishoil",
        "brain",
        "heart",
        "joints",
        "inflammation",
      ],
      "Creatine Monohydrate": [
        "creatine",
        "gym",
        "fitness",
        "muscle",
        "workout",
        "gains",
        "strength",
      ],
      "Probiotic Complex": [
        "probiotic",
        "gut",
        "digestion",
        "digestive",
        "bloating",
        "microbiome",
      ],
      "Collagen Peptides": [
        "collagen",
        "skin",
        "beauty",
        "skincare",
        "antiaging",
        "glow",
      ],
    };

    for (const [product, triggers] of Object.entries(productMappings)) {
      if (triggers.some((t) => keywordSet.has(t))) {
        return product;
      }
    }

    return undefined;
  }

  /**
   * Update alert configuration.
   */
  updateConfig(updates: Partial<AlertConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      thresholds: {
        ...this.config.thresholds,
        ...updates.thresholds,
      },
    };
  }

  /**
   * Get current config.
   */
  getConfig(): Readonly<AlertConfig> {
    return { ...this.config };
  }
}
