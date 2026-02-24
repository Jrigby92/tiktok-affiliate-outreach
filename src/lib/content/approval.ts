/**
 * Content Approval Gate
 *
 * NON-NEGOTIABLE RULE #1: Every content idea must be approved by the business
 * owner (via SMS, Telegram, email, or in-app) BEFORE it reaches a creator.
 *
 * Flow:
 * 1. Brief generated → notify owner via preferred channel(s)
 * 2. Brief held in "pending_approval" state
 * 3. Owner: approve, reject (with reason), or edit
 * 4. Only after approval → deliver via TikTok IM or collaboration invitation
 *    through the delay layer (Non-Negotiable Rule #2)
 * 5. Rejected briefs logged with reason
 */

import { Pool } from "pg";
import {
  ContentBrief,
  ApprovalStatus,
  OwnerDecision,
  NotificationChannel,
  ApprovalNotification,
} from "./types";

export interface ApprovalGateConfig {
  /** Owner's preferred notification channels (in priority order) */
  preferredChannels: NotificationChannel[];
  /** Slack webhook for in-app notifications */
  slackWebhookUrl?: string;
  /** SMS API endpoint */
  smsApiEndpoint?: string;
  /** Telegram bot token */
  telegramBotToken?: string;
  /** Telegram chat ID for the owner */
  telegramChatId?: string;
  /** Email API endpoint */
  emailApiEndpoint?: string;
  /** Owner's email address */
  ownerEmail?: string;
  /** Owner's phone number (for SMS) */
  ownerPhone?: string;
}

export class ContentApprovalGate {
  private db: Pool;
  private config: ApprovalGateConfig;

  constructor(db: Pool, config: ApprovalGateConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * Ensure the content_briefs table exists.
   */
  async ensureTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS content_briefs (
        id SERIAL PRIMARY KEY,
        brief_id TEXT UNIQUE NOT NULL,
        brief_data JSONB NOT NULL,
        brief_text TEXT NOT NULL,
        approval_status TEXT NOT NULL DEFAULT 'pending_approval',
        owner_decision JSONB,
        target_creator_ids TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_content_briefs_status
        ON content_briefs (approval_status);
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_content_briefs_created
        ON content_briefs (created_at DESC);
    `);
  }

  /**
   * Submit a brief for owner approval.
   * The brief is held pending — it CANNOT reach a creator until approved.
   */
  async submitForApproval(brief: ContentBrief): Promise<void> {
    await this.ensureTable();

    // Persist the brief
    await this.db.query(
      `INSERT INTO content_briefs
         (brief_id, brief_data, brief_text, approval_status, target_creator_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (brief_id) DO UPDATE SET
         brief_data = EXCLUDED.brief_data,
         brief_text = EXCLUDED.brief_text,
         approval_status = EXCLUDED.approval_status`,
      [
        brief.briefId,
        JSON.stringify(brief),
        brief.briefText,
        "pending_approval",
        brief.targetCreatorIds,
      ]
    );

    // Notify the owner via all preferred channels
    const notification: ApprovalNotification = {
      briefId: brief.briefId,
      channels: this.config.preferredChannels,
      briefSummary: this.summarizeBrief(brief),
      trendContext: brief.trendMatch.viralHook,
      productName: brief.productAlignment.productName,
    };

    await this.notifyOwner(notification);
  }

  /**
   * Record the owner's decision on a brief.
   */
  async recordDecision(
    briefId: string,
    decision: OwnerDecision
  ): Promise<ContentBrief | null> {
    const newStatus: ApprovalStatus =
      decision.action === "approve"
        ? "approved"
        : decision.action === "reject"
          ? "rejected"
          : "edited";

    const briefText =
      decision.action === "edit" && decision.editedBriefText
        ? decision.editedBriefText
        : undefined;

    const updateQuery = briefText
      ? `UPDATE content_briefs
         SET approval_status = $1, owner_decision = $2, resolved_at = NOW(), brief_text = $3
         WHERE brief_id = $4
         RETURNING *`
      : `UPDATE content_briefs
         SET approval_status = $1, owner_decision = $2, resolved_at = NOW()
         WHERE brief_id = $3
         RETURNING *`;

    const params = briefText
      ? [newStatus, JSON.stringify(decision), briefText, briefId]
      : [newStatus, JSON.stringify(decision), briefId];

    const result = await this.db.query(updateQuery, params);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const briefData =
      typeof row.brief_data === "string"
        ? JSON.parse(row.brief_data)
        : row.brief_data;

    return {
      ...briefData,
      approvalStatus: row.approval_status,
      ownerDecision: decision,
      resolvedAt: row.resolved_at,
      briefText: row.brief_text,
    };
  }

  /**
   * Check if a brief is approved for delivery.
   * Returns the brief if approved, null if not.
   */
  async getApprovedBrief(briefId: string): Promise<ContentBrief | null> {
    const result = await this.db.query(
      `SELECT * FROM content_briefs WHERE brief_id = $1 AND approval_status IN ('approved', 'edited')`,
      [briefId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const briefData =
      typeof row.brief_data === "string"
        ? JSON.parse(row.brief_data)
        : row.brief_data;

    return {
      ...briefData,
      approvalStatus: row.approval_status,
      ownerDecision: row.owner_decision
        ? typeof row.owner_decision === "string"
          ? JSON.parse(row.owner_decision)
          : row.owner_decision
        : undefined,
      resolvedAt: row.resolved_at,
      briefText: row.brief_text,
    };
  }

  /**
   * Get all pending briefs awaiting approval.
   */
  async getPendingBriefs(): Promise<ContentBrief[]> {
    const result = await this.db.query(
      `SELECT * FROM content_briefs
       WHERE approval_status = 'pending_approval'
       ORDER BY created_at DESC`
    );

    return result.rows.map((row) => {
      const briefData =
        typeof row.brief_data === "string"
          ? JSON.parse(row.brief_data)
          : row.brief_data;
      return {
        ...briefData,
        approvalStatus: row.approval_status,
        briefText: row.brief_text,
      };
    });
  }

  /**
   * Get rejected briefs with reasons (for audit).
   */
  async getRejectedBriefs(limit: number = 50): Promise<ContentBrief[]> {
    const result = await this.db.query(
      `SELECT * FROM content_briefs
       WHERE approval_status = 'rejected'
       ORDER BY resolved_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => {
      const briefData =
        typeof row.brief_data === "string"
          ? JSON.parse(row.brief_data)
          : row.brief_data;
      return {
        ...briefData,
        approvalStatus: row.approval_status,
        ownerDecision: row.owner_decision
          ? typeof row.owner_decision === "string"
            ? JSON.parse(row.owner_decision)
            : row.owner_decision
          : undefined,
        resolvedAt: row.resolved_at,
        briefText: row.brief_text,
      };
    });
  }

  // ─── Owner Notification ───

  /**
   * Notify the owner via all configured channels.
   */
  private async notifyOwner(
    notification: ApprovalNotification
  ): Promise<void> {
    const results = await Promise.allSettled(
      notification.channels.map((channel) =>
        this.sendNotification(channel, notification)
      )
    );

    // Log failures but don't throw — at least one channel should succeed
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          "Notification channel failed:",
          result.reason
        );
      }
    }
  }

  /**
   * Send a notification via a specific channel.
   */
  private async sendNotification(
    channel: NotificationChannel,
    notification: ApprovalNotification
  ): Promise<void> {
    switch (channel) {
      case "sms":
        return this.sendSMS(notification);
      case "telegram":
        return this.sendTelegram(notification);
      case "email":
        return this.sendEmail(notification);
      case "in_app":
        return this.sendInApp(notification);
    }
  }

  private async sendSMS(notification: ApprovalNotification): Promise<void> {
    if (!this.config.smsApiEndpoint || !this.config.ownerPhone) return;

    const message = `[Andinn] New content brief for "${notification.productName}" using "${notification.trendContext}" hook. Review: ${notification.briefId}`;

    await fetch(this.config.smsApiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: this.config.ownerPhone,
        message,
      }),
    });
  }

  private async sendTelegram(
    notification: ApprovalNotification
  ): Promise<void> {
    if (!this.config.telegramBotToken || !this.config.telegramChatId) return;

    const message = `📋 *New Content Brief*\n\n*Product:* ${notification.productName}\n*Hook:* ${notification.trendContext}\n\n${notification.briefSummary}\n\nBrief ID: \`${notification.briefId}\`\nReply with: ✅ approve, ❌ reject, or ✏️ edit`;

    await fetch(
      `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.telegramChatId,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );
  }

  private async sendEmail(
    notification: ApprovalNotification
  ): Promise<void> {
    if (!this.config.emailApiEndpoint || !this.config.ownerEmail) return;

    await fetch(this.config.emailApiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "briefs@andinn-organics.co.uk",
        to: [this.config.ownerEmail],
        subject: `[Action Required] Content Brief: ${notification.productName}`,
        html: `
          <h2>New Content Brief Pending Approval</h2>
          <p><strong>Product:</strong> ${notification.productName}</p>
          <p><strong>Trend Hook:</strong> ${notification.trendContext}</p>
          <p>${notification.briefSummary}</p>
          <p>Brief ID: <code>${notification.briefId}</code></p>
          <p>
            <a href="/dashboard/briefs/${notification.briefId}">Review in Dashboard</a>
          </p>
        `,
      }),
    });
  }

  private async sendInApp(
    notification: ApprovalNotification
  ): Promise<void> {
    // In-app notification is handled by the admin dashboard polling the DB.
    // Optionally also push to Slack for real-time notification.
    if (!this.config.slackWebhookUrl) return;

    await fetch(this.config.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `📋 Content Brief: ${notification.productName}`,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Hook:* ${notification.trendContext}\n${notification.briefSummary}\n\nBrief ID: \`${notification.briefId}\``,
            },
          },
        ],
      }),
    });
  }

  // ─── Helpers ───

  private summarizeBrief(brief: ContentBrief): string {
    const compliance = brief.regulatoryCheck.passed
      ? "Compliance: PASSED"
      : "Compliance: NEEDS REVIEW";

    return `Hook: "${brief.trendMatch.viralHook}" | Product: ${brief.productAlignment.productName} | ${compliance} | Score: ${brief.trendMatch.relevanceScore}/100`;
  }
}
