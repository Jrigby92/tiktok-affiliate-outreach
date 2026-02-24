/**
 * Content Ideation & Approval Types
 */

import { ComplianceResult } from "@/lib/regulatory/compliance/engine";
import { StoredTrend } from "@/lib/trends/types";

// ─── Content Brief ───

export interface ContentBrief {
  /** Unique brief ID */
  briefId: string;
  /** The trend that triggered this brief */
  trendMatch: TrendMatchResult;
  /** Product alignment */
  productAlignment: ProductAlignmentResult;
  /** Regulatory check results */
  regulatoryCheck: RegulatoryCheckResult;
  /** Creative guardrails and suggestions */
  creativeGuards: CreativeGuardsResult;
  /** The final brief text (ready to send to creator) */
  briefText: string;
  /** Approval status */
  approvalStatus: ApprovalStatus;
  /** Target creator(s) */
  targetCreatorIds: string[];
  /** When the brief was generated */
  createdAt: Date;
  /** When the brief was approved/rejected */
  resolvedAt?: Date;
  /** Owner's decision details */
  ownerDecision?: OwnerDecision;
}

// ─── Step 1: Trend Match ───

export interface TrendMatchResult {
  /** The source trend */
  trend: StoredTrend;
  /** Identified viral hook (e.g., "Day in the Life", "Morning Routine") */
  viralHook: string;
  /** Hook category */
  hookCategory: string;
  /** Relevance score to health/wellness (0–100) */
  relevanceScore: number;
}

// ─── Step 2: Product Alignment ───

export interface ProductAlignmentResult {
  /** Product ID */
  productId: string;
  /** Product name */
  productName: string;
  /** How the product maps to the trend hook */
  alignmentReason: string;
  /** Alignment score (0–100) */
  alignmentScore: number;
  /** Key product benefits to highlight */
  keyBenefits: string[];
}

// ─── Step 3: Regulatory Check ───

export interface RegulatoryCheckResult {
  /** Full compliance engine result */
  complianceResult: ComplianceResult;
  /** Authorized health claims that can be used */
  authorizedClaims: string[];
  /** Mandatory specific health claims (SHCs) to include */
  mandatorySHCs: string[];
  /** Terms that were stripped from the draft */
  strippedTerms: string[];
  /** Whether the brief passed compliance */
  passed: boolean;
}

// ─── Step 4: Creative Guards ───

export interface CreativeGuardsResult {
  /** Suggested video transitions */
  suggestedTransitions: string[];
  /** Approved hashtags to use */
  approvedHashtags: string[];
  /** Trending audio (only if is_business_approved = true) */
  trendingAudio?: {
    soundId: string;
    title: string;
    artist?: string;
  };
  /** Content structure suggestions */
  contentStructure: string[];
}

// ─── Approval Gate ───

export type ApprovalStatus =
  | "pending_generation"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "edited";

export type NotificationChannel = "sms" | "telegram" | "email" | "in_app";

export interface OwnerDecision {
  /** The decision */
  action: "approve" | "reject" | "edit";
  /** Reason for rejection */
  rejectionReason?: string;
  /** Edited brief text (if action = edit) */
  editedBriefText?: string;
  /** Which channel the owner responded through */
  respondedVia: NotificationChannel;
  /** When the decision was made */
  decidedAt: Date;
}

export interface ApprovalNotification {
  /** Brief being reviewed */
  briefId: string;
  /** Channels to notify */
  channels: NotificationChannel[];
  /** Brief summary for notification */
  briefSummary: string;
  /** Trend context */
  trendContext: string;
  /** Product name */
  productName: string;
}
