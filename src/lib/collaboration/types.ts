/**
 * Collaboration Management Types
 */

import { CommissionConfig, SampleType } from "@/lib/api/tiktok";

export type CollaborationType = "open" | "target";

/**
 * A collaboration record stored in the local database.
 */
export interface StoredCollaboration {
  id: number;
  type: CollaborationType;
  collaborationId: string;
  creatorId: string;
  creatorHandle: string;
  productIds: string[];
  commissionConfig: CommissionConfig;
  sampleType: SampleType;
  status: "pending" | "accepted" | "rejected" | "expired" | "active";
  matchScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Open Collaboration enrollment configuration.
 */
export interface OpenEnrollmentConfig {
  productId: string;
  commission: CommissionConfig;
  sampleType: "free_manual" | "free_auto_optimized" | "refundable";
  /** Auto-approve sample requests above this engagement rate */
  autoApproveThreshold: number;
}

/**
 * Target Collaboration campaign configuration.
 */
export interface TargetCampaignConfig {
  productIds: string[];
  commission: CommissionConfig;
  sampleType: "free_manual" | "free_auto_approve";
  /** Personalized message template (supports {creatorName}, {productName}) */
  messageTemplate: string;
  /** Minimum match score to include in invitations */
  minMatchScore: number;
  /** Maximum invitations to send in this campaign run */
  maxInvitations: number;
}

/**
 * Result of a target campaign run.
 */
export interface TargetCampaignResult {
  sent: number;
  queued: number;
  failed: number;
  limitReached: boolean;
  invitations: Array<{
    creatorId: string;
    creatorHandle: string;
    status: "sent" | "queued" | "failed";
    error?: string;
  }>;
}
