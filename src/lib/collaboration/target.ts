/**
 * Target Collaboration Management
 *
 * Invite-only collaborations for high-value creators.
 *
 * Key behaviors:
 * - Agent proactively selects and invites creators based on match scores
 * - Individually negotiated higher commission rates (1–80%)
 * - Commission ALWAYS supersedes Open rate — no double-counting
 * - Maximum 1,000 invitations per 24 hours (enforced by TikTok API client)
 * - Samples: free (manual or auto-approve)
 * - All invitations go through the delay layer (Non-Negotiable Rule #2)
 */

import { Pool } from "pg";
import { TikTokApiClient } from "@/lib/api/tiktok";
import { InfluencerMessageSender } from "@/lib/messaging/sender";
import { CreatorProductMatch } from "@/lib/creators/types";
import {
  TargetCampaignConfig,
  TargetCampaignResult,
  StoredCollaboration,
} from "./types";

export class TargetCollaborationManager {
  private tiktokClient: TikTokApiClient;
  private messageSender: InfluencerMessageSender;
  private db: Pool;

  constructor(
    tiktokClient: TikTokApiClient,
    messageSender: InfluencerMessageSender,
    db: Pool
  ) {
    this.tiktokClient = tiktokClient;
    this.messageSender = messageSender;
    this.db = db;
  }

  /**
   * Run a target campaign: invite high-scoring creators from match-making results.
   *
   * - Uses match scores to select creators above minMatchScore
   * - Respects the 1,000/day invitation limit
   * - Sends all invitations through the delay layer
   * - Queues excess invitations for the next day
   */
  async runCampaign(
    matches: CreatorProductMatch[],
    config: TargetCampaignConfig
  ): Promise<TargetCampaignResult> {
    // Validate commission
    if (config.commission.flatRate !== undefined) {
      if (config.commission.flatRate < 1 || config.commission.flatRate > 80) {
        throw new Error("Commission rate must be between 1% and 80%");
      }
    }

    // Filter by minimum match score
    const eligible = matches.filter(
      (m) => m.matchScore >= config.minMatchScore
    );

    // Limit to maxInvitations
    const toInvite = eligible.slice(0, config.maxInvitations);

    const result: TargetCampaignResult = {
      sent: 0,
      queued: 0,
      failed: 0,
      limitReached: false,
      invitations: [],
    };

    for (const match of toInvite) {
      // Check daily limit
      const inviteStatus = this.tiktokClient.getDailyInviteCount();
      if (inviteStatus.count >= inviteStatus.limit) {
        result.limitReached = true;
        result.queued++;
        result.invitations.push({
          creatorId: match.creatorId,
          creatorHandle: match.creatorHandle || "",
          status: "queued",
          error: "Daily invitation limit reached — queued for tomorrow",
        });

        // Store queued invitation for retry
        await this.queueInvitation(match, config);
        continue;
      }

      try {
        // Personalize message
        const message = this.personalizeMessage(
          config.messageTemplate,
          match.creatorHandle || "",
          match.productName || ""
        );

        // Send through delay layer (Non-Negotiable Rule #2)
        await this.messageSender.sendCollaborationInvitation({
          creatorId: match.creatorId,
          productIds: config.productIds,
          commissionRate: config.commission.flatRate || 0,
          message,
        });

        // Store in local DB
        await this.storeCollaboration(match, config);

        result.sent++;
        result.invitations.push({
          creatorId: match.creatorId,
          creatorHandle: match.creatorHandle || "",
          status: "sent",
        });
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";

        // Check if it's a daily limit error from the API
        if (errorMsg.includes("Daily invitation limit")) {
          result.limitReached = true;
          result.queued++;
          result.invitations.push({
            creatorId: match.creatorId,
            creatorHandle: match.creatorHandle || "",
            status: "queued",
            error: errorMsg,
          });
          await this.queueInvitation(match, config);
        } else {
          result.failed++;
          result.invitations.push({
            creatorId: match.creatorId,
            creatorHandle: match.creatorHandle || "",
            status: "failed",
            error: errorMsg,
          });
        }
      }
    }

    return result;
  }

  /**
   * Invite a single creator to a Target Collaboration.
   * Goes through the delay layer.
   */
  async inviteSingleCreator(
    creatorId: string,
    creatorHandle: string,
    productIds: string[],
    commissionRate: number,
    message: string
  ): Promise<{ sent: boolean; error?: string }> {
    try {
      await this.messageSender.sendCollaborationInvitation({
        creatorId,
        productIds,
        commissionRate,
        message,
      });
      return { sent: true };
    } catch (error) {
      return {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get all active Target Collaborations.
   */
  async getActiveCollaborations(): Promise<StoredCollaboration[]> {
    const result = await this.db.query(
      `SELECT * FROM collaborations
       WHERE type = 'target' AND status IN ('pending', 'active', 'accepted')
       ORDER BY match_score DESC NULLS LAST`
    );

    return result.rows.map(this.rowToCollaboration);
  }

  /**
   * Get current daily invitation status.
   */
  getDailyInviteStatus(): { count: number; limit: number; remaining: number } {
    const status = this.tiktokClient.getDailyInviteCount();
    return {
      count: status.count,
      limit: status.limit,
      remaining: status.limit - status.count,
    };
  }

  // ─── Private Helpers ───

  private personalizeMessage(
    template: string,
    creatorName: string,
    productName: string
  ): string {
    return template
      .replace(/\{creatorName\}/g, creatorName)
      .replace(/\{productName\}/g, productName);
  }

  private async storeCollaboration(
    match: CreatorProductMatch,
    config: TargetCampaignConfig
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO collaborations
       (type, collaboration_id, creator_id, creator_handle, product_ids, commission_config, sample_type, status, match_score)
       VALUES ('target', $1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT (collaboration_id) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        `target_${match.creatorId}_${Date.now()}`,
        match.creatorId,
        match.creatorHandle,
        config.productIds,
        JSON.stringify(config.commission),
        config.sampleType,
        match.matchScore,
      ]
    );
  }

  private async queueInvitation(
    match: CreatorProductMatch,
    config: TargetCampaignConfig
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO queued_invitations
       (creator_id, creator_handle, product_ids, commission_config, sample_type, message_template, match_score, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        match.creatorId,
        match.creatorHandle,
        config.productIds,
        JSON.stringify(config.commission),
        config.sampleType,
        config.messageTemplate,
        match.matchScore,
        new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
      ]
    );
  }

  private rowToCollaboration(
    row: Record<string, unknown>
  ): StoredCollaboration {
    return {
      id: row.id as number,
      type: row.type as "open" | "target",
      collaborationId: row.collaboration_id as string,
      creatorId: row.creator_id as string,
      creatorHandle: row.creator_handle as string,
      productIds: row.product_ids as string[],
      commissionConfig:
        typeof row.commission_config === "string"
          ? JSON.parse(row.commission_config as string)
          : (row.commission_config as StoredCollaboration["commissionConfig"]),
      sampleType: row.sample_type as StoredCollaboration["sampleType"],
      status: row.status as StoredCollaboration["status"],
      matchScore: row.match_score as number | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
