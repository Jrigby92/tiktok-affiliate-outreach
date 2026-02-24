/**
 * Open Collaboration Management
 *
 * Products enrolled in "Open Plan" are visible to ALL eligible UK creators.
 *
 * Key behaviors:
 * - Commission: flat, tiered, or auto-optimized (1–80%)
 * - Samples: free (manual or auto-optimized) + refundable
 * - Auto-approve sample requests above engagement threshold
 * - Commission precedence: Target always supersedes Open (do not double-count)
 */

import { Pool } from "pg";
import {
  TikTokApiClient,
  OpenSampleRequest,
  CollaborationResponse,
} from "@/lib/api/tiktok";
import { OpenEnrollmentConfig, StoredCollaboration } from "./types";

export class OpenCollaborationManager {
  private tiktokClient: TikTokApiClient;
  private db: Pool;

  constructor(tiktokClient: TikTokApiClient, db: Pool) {
    this.tiktokClient = tiktokClient;
    this.db = db;
  }

  /**
   * Enroll a product in Open Collaboration Plan.
   * Makes the product visible to all eligible UK creators.
   */
  async enrollProduct(
    config: OpenEnrollmentConfig
  ): Promise<CollaborationResponse> {
    // Validate commission rate (1–80%)
    if (config.commission.flatRate !== undefined) {
      if (config.commission.flatRate < 1 || config.commission.flatRate > 80) {
        throw new Error("Commission rate must be between 1% and 80%");
      }
    }

    const apiResult = await this.tiktokClient.enrollOpenCollaboration({
      productIds: [config.productId],
      commissionConfig: config.commission,
      sampleTypes: [config.sampleType],
      autoApproveThreshold: config.autoApproveThreshold,
    });

    const response: CollaborationResponse = {
      collaborationId: apiResult.collaborationId,
      creatorId: "",
      status: "active",
    };

    // Store in local DB
    await this.db.query(
      `INSERT INTO collaborations (type, collaboration_id, creator_id, creator_handle, product_ids, commission_config, sample_type, status)
       VALUES ('open', $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (collaboration_id) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        response.collaborationId,
        response.creatorId,
        "", // Open collaboration has no specific creator
        [config.productId],
        JSON.stringify(config.commission),
        config.sampleType,
        response.status,
      ]
    );

    return response;
  }

  /**
   * Monitor and auto-approve sample requests based on engagement threshold.
   *
   * For each pending request:
   * - If creator engagement >= threshold → auto-approve
   * - Otherwise → leave for manual review
   */
  async processAutoApprovals(
    productId: string,
    engagementThreshold: number
  ): Promise<{
    approved: string[];
    pendingManual: string[];
  }> {
    const pendingRequests =
      await this.tiktokClient.listOpenSampleRequests(productId);

    const approved: string[] = [];
    const pendingManual: string[] = [];

    for (const request of pendingRequests) {
      if (request.status !== "pending") continue;

      // Look up creator engagement from local DB
      const creatorResult = await this.db.query(
        "SELECT engagement_metrics FROM creators WHERE handle = $1",
        [request.creatorHandle]
      );

      if (creatorResult.rows.length === 0) {
        // Unknown creator — manual review
        pendingManual.push(request.requestId);
        continue;
      }

      const metrics = creatorResult.rows[0].engagement_metrics;
      const engagementRate =
        typeof metrics === "string"
          ? JSON.parse(metrics).engagementRate
          : metrics.engagementRate;

      if (engagementRate >= engagementThreshold) {
        await this.tiktokClient.decideSample({
          requestId: request.requestId,
          decision: "approve",
          reason: `Auto-approved: engagement rate ${(engagementRate * 100).toFixed(1)}% >= threshold ${(engagementThreshold * 100).toFixed(1)}%`,
        });
        approved.push(request.requestId);
      } else {
        pendingManual.push(request.requestId);
      }
    }

    return { approved, pendingManual };
  }

  /**
   * Get all active Open Collaboration enrollments.
   */
  async getActiveEnrollments(): Promise<StoredCollaboration[]> {
    const result = await this.db.query(
      `SELECT * FROM collaborations
       WHERE type = 'open' AND status IN ('pending', 'active', 'accepted')
       ORDER BY created_at DESC`
    );

    return result.rows.map(this.rowToCollaboration);
  }

  /**
   * List all pending sample requests for an Open Collaboration product.
   */
  async getPendingSampleRequests(
    productId?: string
  ): Promise<OpenSampleRequest[]> {
    return this.tiktokClient.listOpenSampleRequests(productId);
  }

  private rowToCollaboration(row: Record<string, unknown>): StoredCollaboration {
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
